import {
  createAudioPlayer,
  VoiceConnection,
  EndBehaviorType,
  createAudioResource,
  AudioPlayer,
  StreamType,
  AudioPlayerStatus,
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
    .on('end', () => {
      console.log('FFmpeg finished processing.');
      resampledStream.end();
    })
    .on('error', (err) => {
      console.error('FFmpeg error during resampling:', err);
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterInactivity,
        duration: 2000,
      },
    });
    audioStream.on('data', (chunk: Buffer) => {
      // console.log(`Streaming audio data for user ${userId}`);
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
    audioStream.on('end', () => {
      console.log(`User ${userId} stopped speaking. Audio stream ended.`);
    });
  });

  receiver.speaking.on('end', (userId: string) => {
    console.log(`User ${userId} finished speaking. Receiver ended.`);
  });

  // Create an audio player: Used to play audio data onto discord
  const audioPlayer: AudioPlayer = createAudioPlayer();
  // Subscribe the connection to the audio player (will play audio on the voice connection)
  // - Attaches audioplayer to active voice channel
  const subscription = voiceChannelConnection.subscribe(audioPlayer);
  // Ensure we handle subscription lifecycle
  if (!subscription) {
    console.error('Failed to subscribe to the voice channel.');
    return;
  }

  
  // Create a PassThrough stream
  // - Writeable stream needed for writing and modifying ai 24khz audio data
  const audioStream = new PassThrough();
  // Resample the audio stream to 48 kHz
  const resampledStream = resampleAudio(audioStream);
  // Create an audio resource from the resampled stream
  const audioResource = createAudioResource(resampledStream, { inputType: StreamType.Raw });
  // Start playback of the resampled audio resource
  audioPlayer.play(audioResource);

  // Audio player events
  audioPlayer.on(AudioPlayerStatus.Playing, (oldState, newState) => {
    console.log('Now Playing AI Voice');
  });
  audioPlayer.on('stateChange', (oldState, newState) => {
    console.log(`Audio player transitioned from ${oldState.status} to ${newState.status}`);
  });



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
    handleMessage(ws, data, audioPlayer, audioStream);
  });
  // When the WebSocket connection is closed
  ws.on('close', () => {
    console.log('Connection to OpenAI Realtime API closed');
    audioStream.end();
  });
}

export default RealtimeWebsocket;

async function handleMessage(
  ws: WebSocket,
  messageStr: string,
  audioPlayer: AudioPlayer,
  audioStream: PassThrough,
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
    //////////////////
    // AUDIO RESPONSES
    //////////////////
    case 'response.audio.delta':
      // TODO: Handle audio data
      // Audio chunk received from OpenAI
      const base64AudioChunk = message.delta;
      const audioBuffer = Buffer.from(base64AudioChunk, 'base64');
      audioStream.write(audioBuffer); // Writes into writable stream

      break;

    case 'response.audio.done':
      console.log('Ai has finished responding');
      break;
    //////////////////
    // TEXT RESPONSES
    //////////////////
    case 'response.text.delta':
      // We got a new text chunk, print it
      process.stdout.write(message.delta);
      break;
    case 'response.text.done':
      // The text is complete, print a new line
      process.stdout.write('\n');
      break;

    case 'response.done':
      console.log('Ai has finished generating the response');
      break;
    case 'error':
      console.log('AI encountered an error:', message.error);
      ws.close();
      break;
  }
}
