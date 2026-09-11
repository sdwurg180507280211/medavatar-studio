import {randomUUID} from 'node:crypto';
import {buildWakePrompt, wakePromptFor} from './config.js';
import {ContextLimitReachedError, RelayControlInterrupt, ResponseTimeoutError} from './chatgptPageAdapter.js';
import {
  otherAgent,
  triggerStatusFor,
  waitingStatusFor,
  type AgentName,
  type AssistantMessage,
  type RelayAgentAdapter,
  type RelayCheckpoint,
  type RelayConfig,
  type RelayStepResult,
} from './types.js';

export class RelayEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayEngineError';
  }
}

export const parseControlDirective = (text: string) => {
  const pattern = /<<AGENT_LOOP_(CONTINUE|DONE|HUMAN_REQUIRED|PAUSE)>>/g;
  let directive: 'CONTINUE' | 'DONE' | 'HUMAN_REQUIRED' | 'PAUSE' | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) directive = match[1] as typeof directive;
  return directive;
};

type Persist = (checkpoint: RelayCheckpoint) => Promise<RelayCheckpoint>;

export class RelayEngine {
  constructor(
    private checkpoint: RelayCheckpoint,
    private readonly config: RelayConfig,
    private readonly agents: Record<AgentName, RelayAgentAdapter>,
    private readonly persist: Persist,
  ) {}

  get snapshot() {
    return this.checkpoint;
  }

  private async save() {
    this.checkpoint = await this.persist(this.checkpoint);
  }

  private async setHumanRequired(reason: string): Promise<RelayStepResult> {
    this.checkpoint.status = 'HUMAN_REQUIRED';
    this.checkpoint.stopReason = reason;
    this.checkpoint.lastError = undefined;
    await this.save();
    return {status: this.checkpoint.status, action: 'terminal', message: reason};
  }

  async initialize() {
    if (this.checkpoint.status === 'IDLE') {
      this.checkpoint.status = waitingStatusFor(this.checkpoint.activeAgent);
      await this.save();
    }
    if (this.checkpoint.pendingTrigger) {
      this.checkpoint.status = triggerStatusFor(this.checkpoint.pendingTrigger.target);
      await this.save();
    }
  }

  async processCompletedResponse(source: AgentName, response: AssistantMessage): Promise<RelayStepResult> {
    if (
      this.checkpoint.lastProcessedAgent === source
      && this.checkpoint.lastAssistantMessageFingerprint === response.fingerprint
    ) {
      return {status: this.checkpoint.status, action: 'wait', message: 'duplicate assistant response ignored'};
    }
    if (this.checkpoint.activeAgent !== source || this.checkpoint.status !== waitingStatusFor(source)) {
      throw new RelayEngineError(`Received Chat ${source} response while relay status is ${this.checkpoint.status}`);
    }

    this.checkpoint.lastAssistantMessageFingerprint = response.fingerprint;
    this.checkpoint.lastProcessedAgent = source;
    this.checkpoint.consecutiveErrors = 0;
    this.checkpoint.lastError = undefined;
    await this.save();

    const directive = parseControlDirective(response.text);
    if (!directive) {
      return this.setHumanRequired(`Chat ${source} finished without a control marker`);
    }
    if (directive === 'DONE') {
      this.checkpoint.status = 'DONE';
      this.checkpoint.stopReason = `Chat ${source} reported AGENT_LOOP_DONE`;
      await this.save();
      return {status: 'DONE', action: 'terminal', message: this.checkpoint.stopReason};
    }
    if (directive === 'HUMAN_REQUIRED') {
      return this.setHumanRequired(`Chat ${source} reported AGENT_LOOP_HUMAN_REQUIRED`);
    }
    if (directive === 'PAUSE') {
      this.checkpoint.status = 'PAUSED';
      this.checkpoint.stopReason = `Chat ${source} reported AGENT_LOOP_PAUSE`;
      await this.save();
      return {status: 'PAUSED', action: 'paused', message: this.checkpoint.stopReason};
    }
    if (this.checkpoint.turn >= this.config.maxTotalTurns) {
      this.checkpoint.status = 'PAUSED';
      this.checkpoint.stopReason = `maxTotalTurns reached (${this.config.maxTotalTurns})`;
      await this.save();
      return {status: 'PAUSED', action: 'paused', message: this.checkpoint.stopReason};
    }

    const target = otherAgent(source);
    let targetState;
    try {
      targetState = await this.agents[target].getPageState();
    } catch (error) {
      if (error instanceof ContextLimitReachedError) {
        return this.setHumanRequired(error.message);
      }
      throw error;
    }
    if (targetState.contextLimitReached) return this.setHumanRequired(`Chat ${target} appears to have reached its context limit`);
    const pending = {
      requestId: randomUUID(),
      source,
      target,
      sourceFingerprint: response.fingerprint,
      targetBaselineFingerprint: targetState.latestAssistant?.fingerprint,
      createdAt: new Date().toISOString(),
    };
    this.checkpoint.status = triggerStatusFor(target);
    this.checkpoint.activeAgent = target;
    this.checkpoint.turn += 1;
    this.checkpoint.lastTriggeredAgent = target;
    this.checkpoint.targetBaselineFingerprint = pending.targetBaselineFingerprint;
    this.checkpoint.pendingTrigger = pending;
    await this.save();

    const prompt = buildWakePrompt(
      wakePromptFor(this.config, target),
      source,
      target,
      response.text,
      this.config.handoffMaxChars,
    );
    try {
      await this.agents[target].sendMessage(prompt);
    } catch (error) {
      this.checkpoint.consecutiveErrors += 1;
      this.checkpoint.lastError = error instanceof Error ? error.message : String(error);
      await this.save();
      throw error;
    }

    this.checkpoint.status = waitingStatusFor(target);
    this.checkpoint.pendingTrigger = undefined;
    this.checkpoint.stopReason = undefined;
    await this.save();
    return {status: this.checkpoint.status, action: 'triggered', message: `Chat ${target} triggered`};
  }

  async recoverPendingTrigger(): Promise<RelayStepResult> {
    const pending = this.checkpoint.pendingTrigger;
    if (!pending) throw new RelayEngineError('Relay has no pending trigger to recover');
    const target = this.agents[pending.target];
    let state;
    try {
      state = await target.getPageState();
    } catch (error) {
      if (error instanceof ContextLimitReachedError) return this.setHumanRequired(error.message);
      throw error;
    }
    const accepted = Boolean(
      state.generating
      || state.latestAssistant && state.latestAssistant.fingerprint !== pending.targetBaselineFingerprint,
    );
    if (accepted) {
      this.checkpoint.status = waitingStatusFor(pending.target);
      this.checkpoint.targetBaselineFingerprint = pending.targetBaselineFingerprint;
      this.checkpoint.pendingTrigger = undefined;
      this.checkpoint.lastError = undefined;
      await this.save();
      return {status: this.checkpoint.status, action: 'wait', message: `Recovered trigger ${pending.requestId}`};
    }
    const ageMs = Date.now() - Date.parse(pending.createdAt);
    if (ageMs < this.config.pendingRecoveryGraceMs) {
      return {status: this.checkpoint.status, action: 'wait', message: `Waiting for pending trigger ${pending.requestId} to become observable`};
    }
    return this.setHumanRequired(`Trigger ${pending.requestId} is ambiguous after restart; no duplicate message was sent`);
  }

  async waitForActiveResponse(shouldAbort?: () => Promise<boolean>): Promise<RelayStepResult> {
    if (this.checkpoint.status !== 'WAITING_A' && this.checkpoint.status !== 'WAITING_B') {
      return {status: this.checkpoint.status, action: 'wait'};
    }
    const source = this.checkpoint.activeAgent;
    const response = await this.agents[source].waitForResponseFinished({
      baselineFingerprint: this.checkpoint.targetBaselineFingerprint,
      timeoutMs: this.config.turnTimeoutMs,
      stableMs: this.config.responseStableMs,
      pollIntervalMs: this.config.pollIntervalMs,
      shouldAbort,
    });
    this.checkpoint.targetBaselineFingerprint = undefined;
    return this.processCompletedResponse(source, response);
  }

  async handleError(error: unknown): Promise<RelayStepResult> {
    if (error instanceof RelayControlInterrupt) throw error;
    if (error instanceof ContextLimitReachedError) {
      return this.setHumanRequired(error.message);
    }
    this.checkpoint.consecutiveErrors += 1;
    this.checkpoint.lastError = error instanceof Error ? error.message : String(error);
    if (this.checkpoint.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      this.checkpoint.status = 'PAUSED';
      this.checkpoint.stopReason = `maxConsecutiveErrors reached (${this.config.maxConsecutiveErrors})`;
      await this.save();
      return {status: 'PAUSED', action: 'paused', message: this.checkpoint.stopReason};
    }
    this.checkpoint.status = 'ERROR';
    await this.save();
    return {status: 'ERROR', action: 'error', message: this.checkpoint.lastError};
  }

  async pause(reason = 'paused by operator') {
    this.checkpoint.status = 'PAUSED';
    this.checkpoint.stopReason = reason;
    await this.save();
  }

  async resume() {
    if (this.checkpoint.status === 'DONE' || this.checkpoint.status === 'HUMAN_REQUIRED') {
      throw new RelayEngineError(`Cannot resume terminal relay status ${this.checkpoint.status}`);
    }
    if (this.checkpoint.pendingTrigger) {
      this.checkpoint.status = triggerStatusFor(this.checkpoint.pendingTrigger.target);
    } else {
      this.checkpoint.status = waitingStatusFor(this.checkpoint.activeAgent);
    }
    this.checkpoint.stopReason = undefined;
    this.checkpoint.lastError = undefined;
    this.checkpoint.consecutiveErrors = 0;
    await this.save();
  }

  async stop(reason = 'stopped by operator') {
    this.checkpoint.status = 'STOPPED';
    this.checkpoint.stopReason = reason;
    await this.save();
  }
}
