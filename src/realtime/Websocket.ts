import {
  createAudioPlayer,
  VoiceConnection,
  EndBehaviorType,
  createAudioResource,
  AudioPlayer,
  StreamType,
} from '@discordjs/voice';
import { Readable } from 'stream';
import WebSocket from 'ws';

async function RealtimeWebsocket(voiceChannelConnection: VoiceConnection) {
  // Voice receiver
  const { receiver } = voiceChannelConnection;
  // Start WebSocket connection to OpenAI Realtime API
  const ai_model_url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  const ws = new WebSocket(ai_model_url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

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
      console.log(`Streaming audio data for user ${userId}`);
      // Send this event to append audio bytes to the input audio buffer. The audio buffer is temporary storage you can write to and later commit
      // Note: By default, Realtime sessions have voice activity detection (VAD) enabled, which means the API will determine when the user has started or stopped speaking, and automatically start to respond.
      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: chunk.toString('base64'),
      }))
    });
    audioStream.on('end', () => {
      console.log(`User ${userId} stopped speaking. Audio stream ended.`);
    });
  });

  receiver.speaking.on('end', (userId: string) => {
    console.log(`User ${userId} finished speaking. Receiver ended.`);
  });

  // Create an audio player
  const audioPlayer: AudioPlayer = createAudioPlayer();
  // Subscribe the connection to the audio player (will play audio on the voice connection)
  const subscription = voiceChannelConnection.subscribe(audioPlayer);
  // Ensure we handle subscription lifecycle
  if (!subscription) {
    console.error('Failed to subscribe to the voice channel.');
    return;
  }

  // Create a single Readable stream for continuous audio
  const audioStream = new Readable({
    read() {}, // No-op; data will be pushed into the stream
  });
  // Audio resource from audio stream 
  const audioResource = createAudioResource(audioStream, { inputType: StreamType.Raw });
  // Start playback of the audio resource
  audioPlayer.play(audioResource);

  //////////////////
  // WebSocket Events
  //////////////////

  // When the WebSocket connection is established
  ws.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
  });

  // When receiving messages from OpenAI
  ws.on('message', (data: any) => {
    handleResponseData(ws, data, audioPlayer, audioStream);
  });
  // When the WebSocket connection is closed
  ws.on('close', () => {
    console.log('Connection to OpenAI Realtime API closed');
    audioStream.push(null); // Finalize the audio stream
  });
}

export default RealtimeWebsocket;

async function handleResponseData(
  ws: WebSocket, 
  messageStr: string, 
  audioPlayer: AudioPlayer,
  audioStream: Readable
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
      const audioBuffer = Buffer.from(base64AudioChunk, "base64");
      audioStream.push(audioBuffer);
      // const resource = createAudioResource(audioBuffer, { inputType: 'raw' });
      break;
    case 'response.audio.done':
      // speaker.end();
      console.log('Ai has finished responding')
      audioStream.push(null);
      ws.close();
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

// async function handleStartConversation(ws: WebSocket, chunk: Buffer) {
//   const createConversationEvent = {
//     type: 'conversation.item.create',
//     item: {
//       type: 'message',
//       role: 'user',
//       content: [
//         {
//           type: 'input_audio',
//           // TODO: Replace with actual audio data from the user
//           // audio: base64AudioData,
//         },
//       ],
//     },
//   };
//   ws.send(JSON.stringify(createConversationEvent));
//   const createResponseEvent = {
//     type: 'response.create',
//     response: {
//       modalities: ['text', 'audio'],
//       instructions: 'Please assist the user.',
//     },
//   };
//   ws.send(JSON.stringify(createResponseEvent));
// }
