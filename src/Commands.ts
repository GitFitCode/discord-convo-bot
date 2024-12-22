/**
 * Centralize all slash commands in a single file
 */

import { SlashCommand } from './Command';
import Info from './commands/Info';
import Ping from './commands/Ping';
import Test from './commands/Test';
import Join from './commands/Join';
import Leave from './commands/Leave';

const Commands: SlashCommand[] = [Info, Ping, Test, Join, Leave];

export default Commands;
