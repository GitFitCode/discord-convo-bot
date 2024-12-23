/**
 * Slash command that instructs the bot to leave the currently connected voice channel.
 *
 * To trigger, type: `/leave` in the Discord server.   
 */

import { CommandInteraction, Client, GuildChannel } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { SlashCommand } from '../Command';
import { COMMAND_LEAVE } from '../utils';

async function executeRun(client: Client, interaction: CommandInteraction) {
   // Make sure we are in a guild
	 if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Get bot's voice connection
  const connection = getVoiceConnection(interaction.guild.id);
  if (!connection) {
    await interaction.reply({
      content: 'I am not connected to any voice channel!',
      ephemeral: true,
    });
    return;
  }

	// Get the voice channel ID
  const channelId = connection.joinConfig.channelId;
  if (!channelId) {
    await interaction.reply({
      content: 'Unable to determine the voice channel ID.',
      ephemeral: true,
    });
    return;
  }
  const voiceChannel = interaction.guild.channels.cache.get(channelId) as GuildChannel | undefined;
  const channelName = voiceChannel?.name ?? 'Unknown Channel';

  // Leave the voice channel
  connection.destroy();

	// Success message
  await interaction.editReply(`Left **${channelName}**.`);
  console.log(`convobot left **${channelName}**.`)
}

const Leave: SlashCommand = {
  name: COMMAND_LEAVE.COMMAND_NAME,
  description: COMMAND_LEAVE.COMMAND_DESCRIPTION,
  run: async (_client: Client, interaction: CommandInteraction) => {
    await executeRun(_client, interaction);
  },
};

export default Leave;
