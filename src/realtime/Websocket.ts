import {
  createAudioPlayer,
  VoiceConnection,
  EndBehaviorType,
  createAudioResource,
  AudioPlayer,
  StreamType,
  AudioPlayerStatus,
  AudioResource,
} from '@discordjs/voice';
import { OpusEncoder } from '@discordjs/opus';
import { PassThrough, Readable } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import WebSocket from 'ws';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function resampleAudio(inputStream: PassThrough): PassThrough {
  const resampledStream = new PassThrough();

  ffmpeg(inputStream)
    .inputOptions(['-f s16le', '-ar 24000', '-ac 1']) // Input: PCM16 mono 24 kHz
    .outputOptions(['-f s16le', '-ar 48000', '-ac 1']) // Output: PCM16 mono 48 kHz
    .on('start', (commandLine) => {
      console.log('FFmpeg command:', commandLine);
    })
    .on('error', (err) => {
      console.error('FFmpeg error during resampling:', err);
    })
    .on('end', () => {
      console.log('FFmpeg finished processing.');
    })
    .pipe(resampledStream, { end: true });

  return resampledStream;
}


async function RealtimeWebsocket(voiceChannelConnection: VoiceConnection) {
  // Voice receiver
  const { receiver } = voiceChannelConnection;
  // Opus Encoder: Used to to encode 48khz audio input from discord
  // to 24khz audio forOpenAI
  const opus24kEncoder = new OpusEncoder(24000, 1);
  // Start WebSocket connection to OpenAI Realtime API
  const ai_model_url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  const ws = new WebSocket(ai_model_url, {
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  /**
   * Receiver events
   *
   * These events are triggered when a user in the voice channel starts or stops speaking.
   */
  receiver.speaking.on('start', (userId: string) => {
    console.log(`User ${userId} started speaking.`);
    // Get the audio stream for the user
    const userAudioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterInactivity,
        duration: 2000,
      },
    });
    userAudioStream.on('data', (chunk: Buffer) => {
      // console.log(Streaming audio data for user ${userId});
      // Send this event to append audio bytes to the input audio buffer. The audio buffer is temporary storage you can write to and later commit
      // Note: By default, Realtime sessions have voice activity detection (VAD) enabled, which means the API will determine when the user has started or stopped speaking, and automatically start to respond.
      const decodedPM = opus24kEncoder.decode(chunk);
      const encodedBase64 = Buffer.from(decodedPM).toString('base64');

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encodedBase64,
          }),
        );
      } else {
        console.error('WebSocket is not open. Cannot send audio data.');
      }
    });
    userAudioStream.on('end', () => {
      console.log(`User ${userId} stopped speaking. Audio stream ended.`);
    });
  });

  receiver.speaking.on('end', (userId: string) => {
    console.log(`User ${userId} finished speaking. Receiver ended.`);
  });


    /**
   * Audio player
   *
   * Used to play audio data onto discord
   */
  // Create an audio player
  const audioPlayer: AudioPlayer = createAudioPlayer();
  // Subscribe the connection to the audio player (will play audio on the voice connection)
  // - Attaches audioplayer to active voice channel
  const subscription = voiceChannelConnection.subscribe(audioPlayer);
  // Ensure we handle subscription lifecycle
  if (!subscription) {
    console.error('Failed to subscribe to the voice channel.');
    return;
  }

  /**
   * Websocket events
   *
   * Events triggered by webscoket connection that enable realtime capture of data from api
   */
  // When the WebSocket connection is established
  ws.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
  });

  // When receiving messages from OpenAI
  ws.on('message', (data: any) => {
    handleMessage(ws, data, audioPlayer);
  });
  // When the WebSocket connection is closed
  ws.on('close', () => {
    console.log('Connection to OpenAI Realtime API closed');
  });
}

export default RealtimeWebsocket;

// We'll keep some global or higher-scope variables:
let currentPassThrough: PassThrough | null = null;
let currentResource: AudioResource | null = null;

async function handleMessage(
  ws: WebSocket,
  messageStr: string,
  audioPlayer: AudioPlayer,
) {
  const message = JSON.parse(messageStr);
  // Define what happens when a message is received
  switch (message.type) {
    case 'session.created':
      console.log('Connection to OpenAI has been established');
      break;

    case 'input_audio_buffer.speech_started':
      // Sent by the server when in server_vad mode to indicate that speech has been detected in the audio buffer. This can happen any time audio is added to the buffer (unless speech is already detected). The client may want to use this event to interrupt audio playback or provide visual feedback to the user.
      console.log('Ai has detected the user has started speaking');
      break;

    case 'input_audio_buffer.speech_stopped':
      // Returned in server_vad mode when the server detects the end of speech in the audio buffer. The server will also send an conversation.item.created event with the user message item that is created from the audio buffer.
      console.log('Ai has detected the user has stopped speaking');
      break;

    case 'input_audio_buffer.committed':
      // Returned when an input audio buffer is committed, either by the client or automatically in server VAD mode. The item_id property is the ID of the user message item that will be created, thus a conversation.item.created event will also be sent to the client.
      console.log('Ai has taken in the audio data');
      break;
    
    case 'response.audio.delta': {
      // If we don't have an active stream, create one now
      if (!currentPassThrough) {
        currentPassThrough = new PassThrough();

        // Resample
        const resampledStream = resampleAudio(currentPassThrough);

        // Create a new audio resource from the resampled stream
        currentResource = createAudioResource(resampledStream, {
          inputType: StreamType.Raw,
        });

        // Start playing the new resource
        audioPlayer.play(currentResource);

        audioPlayer.on(AudioPlayerStatus.Playing, () => {
          console.log('Now playing AI voice (new response).');
        });

        audioPlayer.on('stateChange', (oldState, newState) => {
          console.log(`Audio player transitioned from ${oldState.status} to ${newState.status}`);
        });
      }

      // Write the new chunk of data to the current PassThrough
      const base64AudioChunk = message.delta;
      const audioBuffer = Buffer.from(base64AudioChunk, 'base64');
      currentPassThrough.write(audioBuffer);

      break;
    }

    // When the audio from this response is done
    case 'response.audio.done': {
      console.log('AI finished responding (audio).');
      // End the current PassThrough if it exists
      if (currentPassThrough && !currentPassThrough.destroyed) {
        currentPassThrough.end();
      }
      // Reset them to null so that the next response triggers new streams/resources
      currentPassThrough = null;
      currentResource = null;
      break;
    }

    case 'error':
      console.log('AI encountered an error:', message.error);
      ws.close();
      break;
  }
}
