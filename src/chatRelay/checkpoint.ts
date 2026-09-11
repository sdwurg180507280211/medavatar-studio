import {randomUUID} from 'node:crypto';
import {open, readFile, rm, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {ensureDir, fileExists} from '../core/io.js';
import {AGENTS, RELAY_STATUSES, type AgentName, type RelayCheckpoint, type RelayControlCommand} from './types.js';

const checkpointSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  status: z.enum(RELAY_STATUSES),
  activeAgent: z.enum(AGENTS),
  turn: z.number().int().nonnegative(),
  consecutiveErrors: z.number().int().nonnegative(),
  lastAssistantMessageFingerprint: z.string().optional(),
  lastProcessedAgent: z.enum(AGENTS).optional(),
  lastTriggeredAgent: z.enum(AGENTS).optional(),
  targetBaselineFingerprint: z.string().optional(),
  pendingTrigger: z.object({
    requestId: z.string().min(1),
    source: z.enum(AGENTS),
    target: z.enum(AGENTS),
    sourceFingerprint: z.string().min(1),
    targetBaselineFingerprint: z.string().optional(),
    createdAt: z.string().datetime(),
  }).optional(),
  stopReason: z.string().optional(),
  lastError: z.string().optional(),
  updatedAt: z.string().datetime(),
});

const controlSchema = z.object({
  id: z.string().min(1),
  command: z.enum(['pause', 'resume', 'stop']),
  requestedAt: z.string().datetime(),
});

export interface RelayPaths {
  root: string;
  checkpoint: string;
  control: string;
  lock: string;
}

export const relayPaths = (checkpointDir: string): RelayPaths => {
  const root = path.resolve(checkpointDir);
  return {
    root,
    checkpoint: path.join(root, 'checkpoint.json'),
    control: path.join(root, 'control.json'),
    lock: path.join(root, 'relay.lock'),
  };
};

const writeJsonAtomic = async (file: string, value: unknown) => {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  await rename(temp, file);
};

export const createInitialCheckpoint = (): RelayCheckpoint => ({
  version: 1,
  runId: randomUUID(),
  status: 'WAITING_A',
  activeAgent: 'A',
  turn: 0,
  consecutiveErrors: 0,
  updatedAt: new Date().toISOString(),
});

export const loadCheckpoint = async (paths: RelayPaths): Promise<RelayCheckpoint | undefined> => {
  if (!(await fileExists(paths.checkpoint))) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(paths.checkpoint, 'utf8'));
  } catch (error) {
    throw new Error(`Relay checkpoint is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return checkpointSchema.parse(raw);
};

export const saveCheckpoint = async (paths: RelayPaths, checkpoint: RelayCheckpoint) => {
  const value = {...checkpoint, updatedAt: new Date().toISOString()};
  await writeJsonAtomic(paths.checkpoint, value);
  return value;
};

export const requestControl = async (paths: RelayPaths, command: RelayControlCommand) => {
  await writeJsonAtomic(paths.control, {id: randomUUID(), command, requestedAt: new Date().toISOString()});
};

export const consumeControl = async (paths: RelayPaths): Promise<RelayControlCommand | undefined> => {
  if (!(await fileExists(paths.control))) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(paths.control, 'utf8'));
  } finally {
    await rm(paths.control, {force: true});
  }
  return controlSchema.parse(value).command;
};

export const acquireRelayLock = async (paths: RelayPaths) => {
  await ensureDir(paths.root);
  try {
    const handle = await open(paths.lock, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({pid: process.pid, acquiredAt: new Date().toISOString()})}\n`, 'utf8');
    await handle.close();
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    let pid: number | undefined;
    try {
      const lock = JSON.parse(await readFile(paths.lock, 'utf8')) as {pid?: unknown};
      if (typeof lock.pid === 'number') pid = lock.pid;
    } catch {
      // A malformed lock is treated as active until it can be removed safely below.
    }
    if (pid) {
      try {
        process.kill(pid, 0);
        throw new Error(`Another ChatGPT Relay is already running (pid ${pid})`);
      } catch (probeError) {
        if (probeError instanceof Error && probeError.message.startsWith('Another ChatGPT Relay')) throw probeError;
      }
    }
    await rm(paths.lock, {force: true});
    const handle = await open(paths.lock, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({pid: process.pid, acquiredAt: new Date().toISOString()})}\n`, 'utf8');
    await handle.close();
  }
  return async () => {
    await rm(paths.lock, {force: true});
  };
};
