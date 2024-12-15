/* eslint-disable object-curly-newline */

/**
 * "interactionCreate" event listener for the bot.
 */

import { CommandInteraction, Client, Interaction, InteractionType } from 'discord.js';
import Commands from '../Commands';

/**
 * Handles slash command interactions.
 *
 * This function is triggered when a slash command is used in Discord. If the command is found, it defers the reply
 * to keep the interaction token valid for long-running tasks and then runs the command. If any error
 * occurs during the execution, it captures and logs the error.
 *
 * @param {Client} client - The Discord client.
 * @param {CommandInteraction} interaction - The interaction object representing the slash command.
 */
const handleSlashCommand = async (
  client: Client,
  interaction: CommandInteraction,
): Promise<void> => {
  const slashCommand = Commands.find((c) => c.name === interaction.commandName);
  if (!slashCommand) {
    interaction.followUp({ content: 'An error has occurred' });
    return;
  }

  await interaction.deferReply();

  slashCommand.run(client, interaction);
};

export default (client: Client): void => {
  client.on('interactionCreate', async (interaction: Interaction) => {
    // Check if interaction is a command and call handleSlashCommand() if so.
    if (interaction.type === InteractionType.ApplicationCommand) {
      await handleSlashCommand(client, interaction);
    }
  });
};
