import {
  createAudioPlayer,
  VoiceConnection,
  EndBehaviorType,
  createAudioResource,
  AudioPlayer,
} from '@discordjs/voice';
import WebSocket from 'ws';

async function RealtimeWebsocket(voiceChannelConnection: VoiceConnection) {
  // Voice receiver
  const { receiver } = voiceChannelConnection;
  // Start WebSocket connection to OpenAI Realtime API
  const ai_model_url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  // const ws = new WebSocket(ai_model_url, {
  //   headers: {
  //     Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  //     'OpenAI-Beta': 'realtime=v1',
  //   },
  // });

  receiver.speaking.on('start', (userId: string) => {
    console.log(`User ${userId} started speaking.`);

    // Get the audio stream for the user
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });

    audioStream.on('data', (chunk: Buffer) => {
      console.log(`Streaming audio data for user ${userId}`);
      console.log(typeof chunk);
      console.log('Data chunk:', chunk);
      // sendAudioData(chunk); // Stream the audio data
      

    });

    audioStream.on('end', () => {
      console.log(`User ${userId} stopped speaking.`);
    });
  });

  receiver.speaking.on('end', (userId: string) => {
    console.log(`User ${userId} finished speaking.`);
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

  // /**
  //  * Socket Events
  //  */
  // ws.on('open', () => {
  //   console.log('Connected to OpenAI Realtime API');
  // });

  // /// When receiving messages from OpenAI
  // ws.on('message', (data: any) => {
  //   handleMessage(ws, data);
  // });


}



export default RealtimeWebsocket;


async function handleMessage(ws: WebSocket, messageStr: string) {
  const message = JSON.parse(messageStr);
  // Define what happens when a message is received
  switch(message.type) {
    case "response.audio.delta":
      // TODO: Handle audio data
      // Audio chunk received from OpenAI
      const base64AudioChunk = message.delta;

      // const audioBuffer = Buffer.from(base64AudioChunk, "base64");
      // speaker.write(audioBuffer);
      break;
    case "response.audio.done":
      // speaker.end();
      // ws.close();
      break;
    case "response.text.delta":
      // We got a new text chunk, print it
      process.stdout.write(message.delta);
    break;
    case "response.text.done":
      // The text is complete, print a new line
      process.stdout.write("\n");
    break;
    case "response.done":
      // Response complete, close the socket
      ws.close();
    break;
  }
}





async function handleStartConversation(ws: WebSocket) {
  const createConversationEvent = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_audio",
          // TODO: Replace with actual audio data from the user
          // audio: base64AudioData,
        },
      ],
    },
  };
  ws.send(JSON.stringify(createConversationEvent));
  const createResponseEvent = {
    type: "response.create",
    response: {
      modalities: ["text", "audio"],
      instructions: "Please assist the user.",
    },
  };
  ws.send(JSON.stringify(createResponseEvent));
}