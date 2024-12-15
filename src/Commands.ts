/**
 * Centralize all slash commands in a single file
 */

import { SlashCommand } from './Command';
import Info from './commands/Info';
import Ping from './commands/Ping';
import Test from './commands/Test';

const Commands: SlashCommand[] = [Info, Ping, Test];

export default Commands;
