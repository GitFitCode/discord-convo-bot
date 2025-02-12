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
import utils from './utils';

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
 * Subscribes to a user's audio stream from Discord.
 * Decodes from Opus to PCM (24kHz), then base64-encodes,
 * and queues the data for sending to OpenAI.
 */
function subscribeToUserAudio(
  userId: string,
  receiver: VoiceConnection['receiver'],
  opusEncoder: OpusEncoder,
  ws: WebSocket,
  audioQueue: string[],
) {
  console.log(`User ${userId} started speaking.`);
  const userAudioStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterInactivity,
      duration: 3000,
    },
  });

  userAudioStream.on('data', (chunk: Buffer) => {
    const decodedPCM = opusEncoder.decode(chunk);
    const encodedBase64 = Buffer.from(decodedPCM).toString('base64');

    if (ws.readyState === WebSocket.OPEN) {
      audioQueue.push(encodedBase64);
    } else {
      console.error('WebSocket is not open. Cannot send audio data.');
    }
  });

  userAudioStream.on('end', () => {
    console.log(`User ${userId} stopped speaking. Audio stream ended.`);
  });
}

/**
 * Main function to handle realtime WebSocket processing.
 */
async function RealtimeWebsocket(voiceChannelConnection: VoiceConnection) {
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

  // Set up a queue and flush timer for throttled sending of audio data.
  const audioQueue: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flushInterval = 100; // flush every 100ms

  /**
   * Receiver events: triggered when a user starts or stops speaking.
   */
  receiver.speaking.on('start', (userId: string) => {
    console.log(`User ${userId} started speaking.`);
    // Subscribe to the user's audio stream.
    const userAudioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterInactivity,
        duration: 3000,
      },
    });

    userAudioStream.on('data', (chunk: Buffer) => {
      const decodedPM = opus24kEncoder.decode(chunk);
      const encodedBase64 = Buffer.from(decodedPM).toString('base64');

      if (ws.readyState === WebSocket.OPEN) {
        // Instead of sending each chunk immediately, push the chunk to the queue.
        audioQueue.push(encodedBase64);
        // Start a flush timer if one is not already running.
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            const combinedAudio = audioQueue.join('');
            ws.send(
              JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: combinedAudio,
              }),
            );
            audioQueue.length = 0;
            flushTimer = null;
          }, flushInterval);
        }
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
   * Audio player: used to play AI audio responses on Discord.
   */
  const audioPlayer: AudioPlayer = createAudioPlayer();
  const subscription = voiceChannelConnection.subscribe(audioPlayer);
  if (!subscription) {
    console.error('Failed to subscribe to the voice channel.');
    return;
  }
  /**
   * WebSocket events for realtime data from OpenAI.
   */
  ws.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
    if (ws.readyState === WebSocket.OPEN) {
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
    } else {
      console.error('WebSocket is not open. Cannot send audio data.');
    }
  });

  ws.on('message', (data: any) => {
    handleMessage(ws, data, audioPlayer);
  });
  ws.on('close', () => {
    console.log('Connection to OpenAI Realtime API closed');
  });
}

export default RealtimeWebsocket;

// Global variables for handling AI audio response streaming.
let currentPassThrough: PassThrough | null = null;
let currentResource: AudioResource | null = null;

async function handleMessage(ws: WebSocket, messageStr: string, audioPlayer: AudioPlayer) {
  const message = JSON.parse(messageStr);
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

        audioPlayer.on(AudioPlayerStatus.Playing, () => {
          console.log('Now playing AI voice (new response).');
        });
        audioPlayer.on('stateChange', (oldState, newState) => {
          console.log(`Audio player transitioned from ${oldState.status} to ${newState.status}`);
        });
      }
      const base64AudioChunk = message.delta;
      const audioBuffer = Buffer.from(base64AudioChunk, 'base64');
      currentPassThrough.write(audioBuffer);
      break;
    }
    case 'response.audio.done': {
      console.log('AI finished responding (audio).');
      if (currentPassThrough && !currentPassThrough.destroyed) {
        currentPassThrough.end();
      }
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
