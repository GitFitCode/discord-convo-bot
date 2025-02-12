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
import TranscriptionClient from './WhisperClient';
import { TranscriptManager } from './TranscriptManager';
import { writeFileSync } from 'fs';

// Global variables for handling AI audio response streaming.
let currentPassThrough: PassThrough | null = null;
let currentResource: AudioResource | null = null;

const transcriptManager = new TranscriptManager();

interface UserSession {
  stream: PassThrough; // Audio stream for processing
  websocket: WebSocket; // WebSocket connection to OpenAI
  audioPlayer: AudioPlayer; // Discord audio player
  currentPassThrough: PassThrough | null; // For streaming AI audio response
  currentResource: AudioResource | null;
  // The audio resource created from currentPassThrough
  transcriptionClient: TranscriptionClient; // Per-user transcription client instance
}

// const activeUsers = new Map<string, UserSession>();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Resample the input audio stream.
 */
function resampleAudio(inputStream: PassThrough): PassThrough {
  const resampledStream = new PassThrough();

  ffmpeg(inputStream)
    .inputOptions(['-f s16le', '-ar 24000', '-ac 1']) // Input: PCM16 mono 24 kHz
    .outputOptions(['-f s16le', '-ar 48000', '-ac 2']) // Output: PCM16 mono 48 kHz
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

/**
 * Subscribes to the user's audio stream, encodes it, and sends it to the WebSocket.
 */
function subscribeToUserAudio(
  userId: string,
  receiver: VoiceConnection['receiver'],
  opusEncoder: OpusEncoder,
  ws: WebSocket,
  audioQueue: string[]
) {
  const audioStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 100,
    },
  });

  const passThroughStream = new PassThrough();
  const resampledStream = resampleAudio(passThroughStream);

  audioStream.pipe(passThroughStream);

  resampledStream.on('data', (chunk) => {
    try {
      // Process smaller chunks to avoid buffer size issues
      const chunkSize = 1024; // Adjust the chunk size as needed
      for (let i = 0; i < chunk.length; i += chunkSize) {
        const smallChunk = chunk.slice(i, i + chunkSize);
        const encodedAudio = opusEncoder.encode(smallChunk);
        const base64Audio = encodedAudio.toString('base64');
        audioQueue.push(base64Audio);
      }
    } catch (error) {
      console.error(`Error encoding audio chunk for user ${userId}:`, error);
    }
  });

  resampledStream.on('end', () => {
    console.log(`Audio stream for user ${userId} ended.`);
  });

  resampledStream.on('error', (error) => {
    console.error(`Error in audio stream for user ${userId}:`, error);
  });
}


/**
 * Flushes the audio queue by sending combined audio data over the WebSocket.
 */
function flushAudioQueue(ws: WebSocket, audioQueue: string[]) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not open. Cannot flush audio data.');
    // return;
  }
  if (audioQueue.length === 0) {
    console.log('No audio data to flush.');
    // return;
  }
  const combinedAudio = audioQueue.join('');
  ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: combinedAudio }));
  audioQueue.length = 0;
}

/**
 * Sets up a periodic timer to flush the audio queue.
 */
function setupFlushTimer(ws: WebSocket, audioQueue: string[], flushIntervalMs: number) {
  return setInterval(() => {
    flushAudioQueue(ws, audioQueue);
  }, flushIntervalMs);
}

/**
 * Main function to handle realtime WebSocket processing.
 */
export default async function RealtimeWebsocket(voiceChannelConnection: VoiceConnection) {
  // Voice receiver from the voice connection.
  const { receiver } = voiceChannelConnection;
  // Create an Opus encoder to convert Discord’s 48kHz audio to 24kHz PCM.
  const opus24kEncoder = new OpusEncoder(24000, 1);
  // Start a WebSocket connection to OpenAI.
  const ai_model_url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  const ws = new WebSocket(ai_model_url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  // Create a queue for storing base64-encoded user audio.
  const audioQueue: string[] = [];
  const flushIntervalMs = 1000;
  const flushIntervalId = setupFlushTimer(ws, audioQueue, flushIntervalMs);

  /**
   * Audio player: used to play AI audio responses on Discord.
   */
  const audioPlayer: AudioPlayer = createAudioPlayer();

  // Attach audio player event listeners.
  audioPlayer.on(AudioPlayerStatus.Playing, () => {
    console.log('Audio player is now playing AI voice.');
  });
  audioPlayer.on('stateChange', (oldState, newState) => {
    console.log(`Audio player transitioned from ${oldState.status} to ${newState.status}`);
  });
  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    console.log('Audio player is idle; flushing audio queue...');
    flushAudioQueue(ws, audioQueue);
  });

  voiceChannelConnection.subscribe(audioPlayer);

  /**
   * WebSocket events for realtime data from OpenAI.
   */
  ws.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful assistant.',
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.4,
            prefix_padding_ms: 200,
            silence_duration_ms: 400,
            create_response: true,
          },
          temperature: 0.8,
          max_response_output_tokens: 'inf',
        },
      }),
    );
  });

  ws.on('message', (data: any) => {
    handleMessage(ws, data, audioPlayer);
  });

  ws.on('close', () => {
    console.log('OpenAI WebSocket closed.');
    clearInterval(flushIntervalId);
    const srtContent = transcriptManager.toSRT();
    try {
      writeFileSync('output.srt', srtContent, { encoding: 'utf-8' });
    } catch (e) {
      console.log(e);
    }
    process.exit(0);
  });

  receiver.speaking.on('start', (userId: string) => {
    subscribeToUserAudio(userId, receiver, opus24kEncoder, ws, audioQueue);
    // Start a new transcript segment for this user.
    transcriptManager.addDelta(userId, '', Date.now());
  });

  receiver.speaking.on('end', (userId: string) => {
    console.log(`User ${userId} finished speaking (receiver ended).`);
    transcriptManager.commitSegment(userId, Date.now());
  });
}

async function handleMessage(ws: WebSocket, data: any, audioPlayer: AudioPlayer) {
  const message = JSON.parse(data.toString());
  switch (message.type) {
    case 'session.created':
      console.log('Connection to OpenAI has been established');
      console.log(message);
      break;
    case 'session.updated':
      console.log('Session updated');
      console.log(message);
      break;
    case 'converation.item.created':
      console.log('Conversation item created');
      console.log(message);
      break;
    case 'conversation.item.input_audio_transcription.completed':
      console.log('Transcription completed');
      transcriptManager.commitSegment('user', Date.now());
      console.log(message);
      break;
    case 'input_audio_buffer.speech_started':
      console.log('Ai has detected the user has started speaking');
      break;
    case 'input_audio_buffer.speech_stopped':
      console.log('Ai has detected the user has stopped speaking');
      break;
    case 'input_audio_buffer.committed':
      console.log('Ai has taken in the audio data');
      break;
    case 'response.audio.delta': {
      if (!currentPassThrough) {
        currentPassThrough = new PassThrough();
        const resampledStream = resampleAudio(currentPassThrough);
        currentResource = createAudioResource(resampledStream, {
          inputType: StreamType.Raw,
        });
        audioPlayer.play(currentResource);
      }
      const base64AudioChunk = message.delta;
      const audioBuffer = Buffer.from(base64AudioChunk, 'base64');
      currentPassThrough.write(audioBuffer);
      break;
    }
    case 'response.audio.done': {
      console.log('AI finished responding (audio).');
      if (currentPassThrough) {
        currentPassThrough.end();
        currentPassThrough = null;
      }
      currentResource = null;
      break;
    }
    case 'error':
      console.log('AI encountered an error:', message.error);
      ws.close();
      break;
    default:
      console.debug('unhandled message type', message.type, message);
      break;
  }
}

process.on('SIGINT', () => {
  console.log('SIGINT received. Flushing audio queue and writing transcript...');
  // Assuming ws and flushIntervalId are in scope or stored globally:
  // (You may need to adapt this if these variables are local.)
  // For this example, we assume the WebSocket will close and its 'close' handler will run.
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Flushing audio queue and writing transcript...');
  process.exit(0);
});