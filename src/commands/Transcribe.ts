/**
 * Slash command that replies with the information of the server and the user who
 * triggered the command.
 *
 * To trigger, type `/help` in the discord server.
 */

import { CommandInteraction, Client } from 'discord.js';
import { version } from '../../package.json';
import { COMMAND_TRANSCRIBE } from '../utils';
import { SlashCommand } from '../Command';

async function executeRun(interaction: CommandInteraction) {
  const content = `\`Your username\`: ${interaction.user.username}
\`${interaction.client.user.username} version\`: ${version}`;

  await interaction.followUp({ ephemeral: true, content });
}

const Transcribe: SlashCommand = {
  name: COMMAND_TRANSCRIBE.COMMAND_NAME,
  description: COMMAND_TRANSCRIBE.COMMAND_DESCRIPTION,
  run: async (_client: Client, interaction: CommandInteraction) => {
    await executeRun(interaction);
  },
};

export default Transcribe;
