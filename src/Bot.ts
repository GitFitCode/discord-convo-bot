/**
 * Entrypoint for the bot.
 */

import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import interactionCreate from './listeners/interactionCreate';
import ready from './listeners/ready';

/**
 * Creates a new Discord Client with specific intents and allowed mentions.
 *
 * Intents are used to specify which events the client should receive.
 * Allowed mentions are used to control who can be mentioned by the bot.
 *
 * @see {@link https://discord.js.org/docs/packages/discord.js/main/Client:Class}
 */
const client = new Client({
  // Intents that the bot client should subscribe to
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  // Control who can be mentioned by the bot
  allowedMentions: { parse: ['users', 'roles', 'everyone'] },
});

/**
 * Starts the bot by registering listeners and logging into Discord.
 *
 * The listeners handle various events such as a new guild member being added,
 * an interaction being created, a message being created, and the bot being ready.
 *
 * After registering the listeners, the bot logs into Discord using the bot token.
 */
function start() {
  // Register the bot client with listeners.
  interactionCreate(client);
  ready(client);

  // Call login on client for authenticating the bot with Discord.
  client.login(process.env.DISCORD_BOT_TOKEN);
}

/**
 * Stops the bot by destroying the client and logging the exit code.
 *
 * @param code - The signal code that triggered the stop.
 */
function stop(code: NodeJS.Signals) {
  // Log out, terminate connection to Discord and destroy the client.
  client.destroy();

  console.log(`\nExiting with code ${code}`);
}

export { start, stop };
