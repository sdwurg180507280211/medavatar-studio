import {relayControl, relayStatus, runRelay} from './relayRunner.js';

const usage = () => {
  console.log(`Usage:
  pnpm chat-relay start [--config <file>]
  pnpm chat-relay status [--config <file>]
  pnpm chat-relay pause [--config <file>]
  pnpm chat-relay resume [--config <file>]
  pnpm chat-relay stop [--config <file>]

The same commands are available as: pnpm medavatar chat-relay <command>
`);
};

const option = (args: string[], name: string) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const current = args[index];
  if (current.startsWith(`${name}=`)) return current.slice(name.length + 1);
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};

export const runChatRelayCli = async (args: string[]) => {
  const command = args[0] ?? 'help';
  const configPath = option(args, '--config');
  if (args.includes('--help') || command === 'help') {
    usage();
    return;
  }
  if (!['start', 'status', 'pause', 'resume', 'stop', 'contract'].includes(command)) {
    usage();
    throw new Error(`Unknown chat-relay command: ${command}`);
  }
  if (command === 'start') return runRelay(configPath);
  if (command === 'status') return relayStatus(configPath);
  if (command === 'contract') {
    await import('./relayContract.js');
    return;
  }
  if (command === 'pause' || command === 'resume' || command === 'stop') {
    return relayControl(command, configPath);
  }
  throw new Error(`Unknown chat-relay command: ${command}`);
};
