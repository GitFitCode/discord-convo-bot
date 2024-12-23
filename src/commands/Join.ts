/**
 * Slash command that joins the voice channel of the user who triggered the command.
 *
 * To trigger, type `/join` in the Discord server.
 */
import { CommandInteraction, Client } from 'discord.js';
import { joinVoiceChannel} from '@discordjs/voice';
import { SlashCommand } from '../Command';
import { COMMAND_JOIN } from '../utils';
import RealtimeWebsocket from '../realtime/Websocket';


async function executeRun(client: Client, interaction: CommandInteraction) {
  // Make sure we are in a guild
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Identify the user’s voice channel
  const member = interaction.guild.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.editReply('You need to join a voice channel first!');
    return;
  }

  // Join the voice channel
  const voiceChannelConnection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  // Success message
  await interaction.editReply(`Joined **${voiceChannel.name}**!`);

  try {
    console.log('Starting the realtime websocket');
    await interaction.editReply(`Starting the realtime websocket...`);
    RealtimeWebsocket(voiceChannelConnection);
  } catch (error) {
    console.log('Error starting the realtime websocket:', error);
    await interaction.editReply(`Error starting the realtime websocket: ${error}`);
  }
}

const Join: SlashCommand = {
  name: COMMAND_JOIN.COMMAND_NAME,
  description: COMMAND_JOIN.COMMAND_DESCRIPTION,
  run: async (_client: Client, interaction: CommandInteraction) => {
    await executeRun(_client, interaction);
  },
};

export default Join;
