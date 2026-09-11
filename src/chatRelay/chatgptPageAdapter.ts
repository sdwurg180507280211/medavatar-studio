import type {ChromeTarget, CdpClient} from './cdp.js';
import {
  clickSendButtonScript,
  focusComposerScript,
  inspectChatGptPageScript,
  installMutationObserverScript,
} from './selectors.js';
import type {AgentName, AssistantMessage, ChatPageState, RelayAgentAdapter} from './types.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ChatRelayPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatRelayPageError';
  }
}

export class ResponseTimeoutError extends ChatRelayPageError {
  constructor(agent: AgentName, timeoutMs: number) {
    super(`Chat ${agent} response did not finish within ${timeoutMs}ms`);
    this.name = 'ResponseTimeoutError';
  }
}

export class ContextLimitReachedError extends ChatRelayPageError {
  constructor(agent: AgentName) {
    super(`Chat ${agent} appears to have reached its context limit`);
    this.name = 'ContextLimitReachedError';
  }
}

export class RelayControlInterrupt extends ChatRelayPageError {
  constructor(public readonly command: 'pause' | 'stop') {
    super(`Relay ${command} requested`);
    this.name = 'RelayControlInterrupt';
  }
}

export class ChatGPTPageAdapter implements RelayAgentAdapter {
  constructor(
    public readonly name: AgentName,
    private readonly client: CdpClient,
    public readonly target: ChromeTarget,
  ) {}

  async initialize() {
    await this.client.call('Runtime.enable');
    await this.client.evaluate(installMutationObserverScript);
  }

  async getPageState(): Promise<ChatPageState> {
    const state = await this.client.evaluate<ChatPageState>(inspectChatGptPageScript);
    if (!state || typeof state !== 'object') throw new ChatRelayPageError(`Chat ${this.name} returned an invalid page state`);
    if (state.contextLimitReached) throw new ContextLimitReachedError(this.name);
    return state;
  }

  async waitForResponseFinished(options: {
    baselineFingerprint?: string;
    timeoutMs: number;
    stableMs: number;
    pollIntervalMs: number;
    shouldAbort?: () => Promise<boolean>;
  }): Promise<AssistantMessage> {
    const startedAt = Date.now();
    let candidateFingerprint: string | undefined;
    let candidateSeenAt = 0;
    while (Date.now() - startedAt < options.timeoutMs) {
      if (options.shouldAbort && await options.shouldAbort()) {
        throw new RelayControlInterrupt('pause');
      }
      const state = await this.getPageState();
      if (!state.hasComposer && Date.now() - startedAt > Math.min(options.timeoutMs, 5000)) {
        throw new ChatRelayPageError(`Chat ${this.name} composer is unavailable; the page may be logged out or not be a ChatGPT conversation`);
      }
      const message = state.latestAssistant;
      const isNew = Boolean(message && message.fingerprint !== options.baselineFingerprint);
      if (isNew && message && !state.generating && state.inputReady) {
        if (candidateFingerprint !== message.fingerprint) {
          candidateFingerprint = message.fingerprint;
          candidateSeenAt = Date.now();
        }
        const quietFor = Date.now() - state.lastMutationAt;
        const candidateAge = Date.now() - candidateSeenAt;
        if (quietFor >= options.stableMs || candidateAge >= options.stableMs) return message;
      } else {
        candidateFingerprint = undefined;
        candidateSeenAt = 0;
      }
      await sleep(options.pollIntervalMs);
    }
    throw new ResponseTimeoutError(this.name, options.timeoutMs);
  }

  async sendMessage(prompt: string): Promise<void> {
    if (!prompt.trim()) throw new ChatRelayPageError(`Refusing to send an empty prompt to Chat ${this.name}`);
    const state = await this.getPageState();
    if (!state.hasComposer || !state.inputReady) {
      throw new ChatRelayPageError(`Chat ${this.name} composer is not ready; refusing to send a duplicate or unsafe prompt`);
    }
    const focused = await this.client.evaluate<boolean>(focusComposerScript);
    if (!focused) throw new ChatRelayPageError(`Unable to focus Chat ${this.name} composer`);
    await this.client.call('Input.insertText', {text: prompt});
    await sleep(100);
    const clicked = await this.client.evaluate<{clicked: boolean}>(clickSendButtonScript);
    if (clicked?.clicked) return;
    await this.client.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await this.client.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }

  async close() {
    await this.client.close();
  }
}
