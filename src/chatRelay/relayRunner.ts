import {loadRelayConfig} from './config.js';
import {CdpClient, listChromeTargets, selectChatTargets} from './cdp.js';
import {ChatGPTPageAdapter, RelayControlInterrupt} from './chatgptPageAdapter.js';
import {
  acquireRelayLock,
  consumeControl,
  createInitialCheckpoint,
  loadCheckpoint,
  relayPaths,
  saveCheckpoint,
} from './checkpoint.js';
import {RelayEngine} from './relayEngine.js';
import {type AgentName, type RelayAgentAdapter, type RelayConfig} from './types.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const connectAgents = async (config: RelayConfig) => {
  const targets = selectChatTargets(
    await listChromeTargets(config.cdpUrl),
    config.conversationA,
    config.conversationB,
  );
  const clients: Record<AgentName, CdpClient> = {
    A: await CdpClient.connect(targets.A.webSocketDebuggerUrl!),
    B: await CdpClient.connect(targets.B.webSocketDebuggerUrl!),
  };
  const adapters: Record<AgentName, ChatGPTPageAdapter> = {
    A: new ChatGPTPageAdapter('A', clients.A, targets.A),
    B: new ChatGPTPageAdapter('B', clients.B, targets.B),
  };
  try {
    await Promise.all([adapters.A.initialize(), adapters.B.initialize()]);
  } catch (error) {
    await Promise.allSettled([adapters.A.close(), adapters.B.close()]);
    throw error;
  }
  return {
    adapters: adapters as Record<AgentName, RelayAgentAdapter>,
    close: async () => Promise.allSettled([adapters.A.close(), adapters.B.close()]),
  };
};

const logStatus = (engine: RelayEngine, message?: string) => {
  const snapshot = engine.snapshot;
  const suffix = message ? ` · ${message}` : '';
  console.log(`[relay] ${snapshot.status} · active=${snapshot.activeAgent} · turn=${snapshot.turn}${suffix}`);
};

export const runRelay = async (rawConfigPath?: string) => {
  const {config, file: configFile} = await loadRelayConfig(rawConfigPath);
  const paths = relayPaths(config.checkpointDir);
  const releaseLock = await acquireRelayLock(paths);
  let connection: Awaited<ReturnType<typeof connectAgents>> | undefined;
  let interrupted = false;
  let engine: RelayEngine | undefined;
  const onSignal = () => { interrupted = true; };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const existing = await loadCheckpoint(paths);
    const checkpoint = existing ?? createInitialCheckpoint();
    if (checkpoint.status === 'DONE' || checkpoint.status === 'HUMAN_REQUIRED') {
      console.log(`[relay] ${checkpoint.status}: ${checkpoint.stopReason ?? 'terminal checkpoint; use a new checkpoint directory for a new run'}`);
      return;
    }
    engine = new RelayEngine(checkpoint, config, {} as Record<AgentName, RelayAgentAdapter>, (value) => saveCheckpoint(paths, value));
    if (checkpoint.status === 'STOPPED' || checkpoint.status === 'ERROR') await engine.resume();
    await engine.initialize();
    console.log(`[relay] starting · config=${configFile} · cdp=${config.cdpUrl}`);
    try {
      connection = await connectAgents(config);
    } catch (error) {
      const result = await engine.handleError(error);
      logStatus(engine, result.message);
      return;
    }
    // The engine receives the connected adapters only after config/checkpoint recovery.
    engine = new RelayEngine(engine.snapshot, config, connection.adapters, (value) => saveCheckpoint(paths, value));
    await engine.initialize();
    logStatus(engine, 'connected to Chat A/B');

    while (!interrupted) {
      const command = await consumeControl(paths);
      if (command === 'stop') {
        await engine.stop();
        logStatus(engine);
        break;
      }
      if (command === 'pause') {
        await engine.pause();
        logStatus(engine);
      } else if (command === 'resume') {
        try {
          await engine.resume();
          logStatus(engine);
        } catch (error) {
          console.error(`[relay] resume rejected: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (engine.snapshot.status === 'DONE' || engine.snapshot.status === 'HUMAN_REQUIRED' || engine.snapshot.status === 'STOPPED') {
        logStatus(engine);
        break;
      }
      if (engine.snapshot.status === 'PAUSED') {
        await sleep(Math.max(config.pollIntervalMs, 1000));
        continue;
      }
      if (engine.snapshot.status === 'ERROR') {
        await sleep(Math.min(config.pollIntervalMs * 2, 5000));
        await engine.resume();
        continue;
      }

      let interruptedCommand: 'pause' | 'stop' | undefined;
      try {
        if (engine.snapshot.pendingTrigger || engine.snapshot.status === 'TRIGGER_A' || engine.snapshot.status === 'TRIGGER_B') {
          const result = await engine.recoverPendingTrigger();
          logStatus(engine, result.message);
          await sleep(config.pollIntervalMs);
          continue;
        }
        const result = await engine.waitForActiveResponse(async () => {
          if (interrupted) {
            interruptedCommand = 'stop';
            return true;
          }
          const requested = await consumeControl(paths);
          if (requested === 'pause' || requested === 'stop') {
            interruptedCommand = requested;
            return true;
          }
          return false;
        });
        logStatus(engine, result.message);
      } catch (error) {
        if (error instanceof RelayControlInterrupt) {
          // waitForResponseFinished uses a pause interrupt for both controls;
          // the command consumed by the callback determines the safe action.
          if (interruptedCommand === 'stop') {
            await engine.stop();
            logStatus(engine);
            break;
          }
          await engine.pause();
          logStatus(engine);
          continue;
        }
        const result = await engine.handleError(error);
        logStatus(engine, result.message);
        if (connection) {
          await connection.close();
          connection = undefined;
        }
        if (result.status === 'ERROR') {
          try {
            connection = await connectAgents(config);
            // Re-create the engine with fresh page adapters while preserving the checkpoint.
            engine = new RelayEngine(engine.snapshot, config, connection.adapters, (value) => saveCheckpoint(paths, value));
          } catch (reconnectError) {
            const reconnectResult = await engine.handleError(reconnectError);
            logStatus(engine, reconnectResult.message);
          }
        }
      }
    }
    if (interrupted && engine && engine.snapshot.status !== 'DONE' && engine.snapshot.status !== 'HUMAN_REQUIRED') {
      await engine.stop('stopped by Ctrl+C / termination signal');
      logStatus(engine);
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await connection?.close();
    await releaseLock();
  }
};

export const relayStatus = async (rawConfigPath?: string) => {
  const {config, file: configFile} = await loadRelayConfig(rawConfigPath);
  const paths = relayPaths(config.checkpointDir);
  const checkpoint = await loadCheckpoint(paths);
  if (!checkpoint) {
    console.log(JSON.stringify({status: 'IDLE', checkpoint: paths.checkpoint, config: configFile}, null, 2));
    return;
  }
  console.log(JSON.stringify({config: configFile, checkpoint}, null, 2));
};

export const relayControl = async (command: 'pause' | 'resume' | 'stop', rawConfigPath?: string) => {
  const {config} = await loadRelayConfig(rawConfigPath);
  const paths = relayPaths(config.checkpointDir);
  const checkpoint = await loadCheckpoint(paths);
  if (!checkpoint) throw new Error(`Relay is not initialized; no checkpoint at ${paths.checkpoint}`);
  const {requestControl} = await import('./checkpoint.js');
  await requestControl(paths, command);
  console.log(`[relay] requested ${command}`);
};
