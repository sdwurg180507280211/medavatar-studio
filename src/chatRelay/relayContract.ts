import assert from 'node:assert/strict';
import {CdpError, selectChatTargets, type ChromeTarget} from './cdp.js';
import {ContextLimitReachedError, ResponseTimeoutError} from './chatgptPageAdapter.js';
import {buildWakePrompt} from './config.js';
import {RelayEngine} from './relayEngine.js';
import type {AgentName, AssistantMessage, ChatPageState, RelayAgentAdapter, RelayCheckpoint, RelayConfig} from './types.js';

const config: RelayConfig = {
  cdpUrl: 'http://127.0.0.1:9222',
  conversationA: 'https://chatgpt.com/g/a/c/a',
  conversationB: 'https://chatgpt.com/g/b/c/b',
  maxTotalTurns: 20,
  maxConsecutiveErrors: 3,
  turnTimeoutMs: 100,
  responseStableMs: 1,
  pollIntervalMs: 1,
  pendingRecoveryGraceMs: 0,
  handoffMaxChars: 1000,
  wakePromptA: 'wake A {sourceAgent} {targetAgent} {sourceResult}',
  wakePromptB: 'wake B {sourceAgent} {targetAgent} {sourceResult}',
  checkpointDir: '.agent-relay-contract',
};

const initial = (): RelayCheckpoint => ({
  version: 1,
  runId: 'contract-run',
  status: 'WAITING_A',
  activeAgent: 'A',
  turn: 0,
  consecutiveErrors: 0,
  updatedAt: new Date().toISOString(),
});

class MockAgent implements RelayAgentAdapter {
  readonly sentPrompts: string[] = [];
  readonly responses: AssistantMessage[] = [];
  pageState: ChatPageState = {
    hasComposer: true,
    inputReady: true,
    generating: false,
    contextLimitReached: false,
    mutationVersion: 0,
    lastMutationAt: Date.now(),
  };
  waitError?: Error;

  constructor(public readonly name: AgentName) {}

  async getPageState() {
    if (this.pageState.contextLimitReached) throw new ContextLimitReachedError(this.name);
    return this.pageState;
  }

  async waitForResponseFinished() {
    if (this.pageState.contextLimitReached) throw new ContextLimitReachedError(this.name);
    if (this.waitError) throw this.waitError;
    const response = this.responses.shift();
    if (!response) throw new Error(`No mock response queued for ${this.name}`);
    return response;
  }

  async sendMessage(prompt: string) {
    this.sentPrompts.push(prompt);
  }
}

const makeEngine = (checkpoint = initial(), a = new MockAgent('A'), b = new MockAgent('B')) => {
  const persisted: RelayCheckpoint[] = [];
  const engine = new RelayEngine(checkpoint, config, {A: a, B: b}, async (value) => {
    const saved = {...value, updatedAt: new Date().toISOString()};
    persisted.push(saved);
    return saved;
  });
  return {engine, a, b, persisted};
};

const response = (fingerprint: string, text: string): AssistantMessage => ({fingerprint, text});

{
  const {engine, a, b} = makeEngine();
  const result = await engine.processCompletedResponse('A', response('a-1', 'A result\n<<AGENT_LOOP_CONTINUE>>'));
  assert.equal(result.status, 'WAITING_B');
  assert.equal(engine.snapshot.activeAgent, 'B');
  assert.equal(engine.snapshot.turn, 1);
  assert.equal(b.sentPrompts.length, 1);
  assert.match(b.sentPrompts[0]!, /A result/);
  assert.equal(a.sentPrompts.length, 0);
  console.log('✓ A CONTINUE triggers B and transfers the result');
}

{
  const {engine, a, b} = makeEngine();
  await engine.processCompletedResponse('A', response('a-1', 'A\n<<AGENT_LOOP_CONTINUE>>'));
  const result = await engine.processCompletedResponse('B', response('b-1', 'B result\n<<AGENT_LOOP_CONTINUE>>'));
  assert.equal(result.status, 'WAITING_A');
  assert.equal(engine.snapshot.activeAgent, 'A');
  assert.match(a.sentPrompts[0]!, /B result/);
  assert.equal(b.sentPrompts.length, 1);
  console.log('✓ B CONTINUE triggers A and transfers the result');
}

{
  const {engine} = makeEngine();
  const result = await engine.processCompletedResponse('A', response('a-done', 'finished\n<<AGENT_LOOP_DONE>>'));
  assert.equal(result.status, 'DONE');
  assert.equal(engine.snapshot.status, 'DONE');
  console.log('✓ DONE stops the relay');
}

{
  const {engine} = makeEngine();
  const result = await engine.processCompletedResponse('A', response('a-human', 'need review\n<<AGENT_LOOP_HUMAN_REQUIRED>>'));
  assert.equal(result.status, 'HUMAN_REQUIRED');
  console.log('✓ HUMAN_REQUIRED stops the relay');
}

{
  const {engine} = makeEngine();
  const result = await engine.processCompletedResponse('A', response('a-no-marker', 'an answer without the relay protocol marker'));
  assert.equal(result.status, 'HUMAN_REQUIRED');
  console.log('✓ missing marker stops safely instead of continuing forever');
}

{
  const {engine} = makeEngine();
  const result = await engine.processCompletedResponse('A', response('a-pause', 'pause\n<<AGENT_LOOP_PAUSE>>'));
  assert.equal(result.status, 'PAUSED');
  console.log('✓ PAUSE pauses the relay');
}

{
  const {engine} = makeEngine();
  (config as RelayConfig).maxTotalTurns = 0;
  const result = await engine.processCompletedResponse('A', response('a-limit', 'continue\n<<AGENT_LOOP_CONTINUE>>'));
  assert.equal(result.status, 'PAUSED');
  (config as RelayConfig).maxTotalTurns = 20;
  console.log('✓ maxTotalTurns stops before another trigger');
}

{
  const {engine, b} = makeEngine();
  await engine.processCompletedResponse('A', response('a-repeat', 'continue\n<<AGENT_LOOP_CONTINUE>>'));
  const result = await engine.processCompletedResponse('A', response('a-repeat', 'duplicate'));
  assert.equal(result.action, 'wait');
  assert.equal(b.sentPrompts.length, 1);
  console.log('✓ duplicate assistant fingerprint is ignored');
}

{
  const checkpoint = initial();
  checkpoint.status = 'TRIGGER_B';
  checkpoint.activeAgent = 'B';
  checkpoint.turn = 1;
  checkpoint.pendingTrigger = {
    requestId: 'pending-1',
    source: 'A',
    target: 'B',
    sourceFingerprint: 'a-1',
    targetBaselineFingerprint: 'b-old',
    createdAt: new Date().toISOString(),
  };
  const {engine, b} = makeEngine(checkpoint);
  b.pageState.generating = true;
  const result = await engine.recoverPendingTrigger();
  assert.equal(result.status, 'WAITING_B');
  assert.equal(b.sentPrompts.length, 0);
  console.log('✓ restart recovery never resends an observable pending trigger');
}

{
  const checkpoint = initial();
  checkpoint.status = 'TRIGGER_B';
  checkpoint.activeAgent = 'B';
  checkpoint.pendingTrigger = {
    requestId: 'pending-ambiguous',
    source: 'A',
    target: 'B',
    sourceFingerprint: 'a-1',
    targetBaselineFingerprint: 'b-old',
    createdAt: new Date(Date.now() - 1000).toISOString(),
  };
  const {engine} = makeEngine(checkpoint);
  const result = await engine.recoverPendingTrigger();
  assert.equal(result.status, 'HUMAN_REQUIRED');
  console.log('✓ ambiguous restart recovery stops safely instead of duplicating');
}

{
  const target = (url: string): ChromeTarget => ({id: url, type: 'page', url, webSocketDebuggerUrl: `ws://${url}`});
  assert.throws(
    () => selectChatTargets([target(config.conversationA)], config.conversationA, config.conversationB),
    (error: unknown) => error instanceof CdpError && /Chat B page not found/.test(error.message),
  );
  console.log('✓ missing Chat page reports a clear error');
}

{
  const {engine, a} = makeEngine();
  a.waitError = new ResponseTimeoutError('A', config.turnTimeoutMs);
  await assert.rejects(() => engine.waitForActiveResponse());
  const result = await engine.handleError(a.waitError);
  assert.equal(result.status, 'ERROR');
  console.log('✓ response timeout enters recoverable ERROR state');
}

{
  const {engine, a} = makeEngine();
  a.pageState.contextLimitReached = true;
  await assert.rejects(() => engine.waitForActiveResponse(), ContextLimitReachedError);
  const result = await engine.handleError(new ContextLimitReachedError('A'));
  assert.equal(result.status, 'HUMAN_REQUIRED');
  console.log('✓ context limit stops the relay for human recovery');
}

assert.match(buildWakePrompt('base {sourceResult}', 'A', 'B', 'x'.repeat(20), 5), /仅传递最后 5 个字符/);
console.log('✓ relay contract: all cases passed');
