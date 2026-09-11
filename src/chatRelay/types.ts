export const AGENTS = ['A', 'B'] as const;
export type AgentName = (typeof AGENTS)[number];

export const RELAY_STATUSES = [
  'IDLE',
  'WAITING_A',
  'TRIGGER_B',
  'WAITING_B',
  'TRIGGER_A',
  'PAUSED',
  'DONE',
  'HUMAN_REQUIRED',
  'ERROR',
  'STOPPED',
] as const;
export type RelayStatus = (typeof RELAY_STATUSES)[number];

export const CONTROL_DIRECTIVES = [
  'CONTINUE',
  'DONE',
  'HUMAN_REQUIRED',
  'PAUSE',
] as const;
export type ControlDirective = (typeof CONTROL_DIRECTIVES)[number];

export type RelayControlCommand = 'pause' | 'resume' | 'stop';

export interface AssistantMessage {
  fingerprint: string;
  text: string;
}

export interface ChatPageState {
  hasComposer: boolean;
  inputReady: boolean;
  generating: boolean;
  contextLimitReached: boolean;
  pageError?: string;
  latestAssistant?: AssistantMessage;
  mutationVersion: number;
  lastMutationAt: number;
}

export interface PendingTrigger {
  requestId: string;
  source: AgentName;
  target: AgentName;
  sourceFingerprint: string;
  targetBaselineFingerprint?: string;
  createdAt: string;
}

export interface RelayCheckpoint {
  version: 1;
  runId: string;
  status: RelayStatus;
  activeAgent: AgentName;
  turn: number;
  consecutiveErrors: number;
  lastAssistantMessageFingerprint?: string;
  lastProcessedAgent?: AgentName;
  lastTriggeredAgent?: AgentName;
  targetBaselineFingerprint?: string;
  pendingTrigger?: PendingTrigger;
  stopReason?: string;
  lastError?: string;
  updatedAt: string;
}

export interface RelayAgentAdapter {
  readonly name: AgentName;
  getPageState(): Promise<ChatPageState>;
  waitForResponseFinished(options: {
    baselineFingerprint?: string;
    timeoutMs: number;
    stableMs: number;
    pollIntervalMs: number;
    shouldAbort?: () => Promise<boolean>;
  }): Promise<AssistantMessage>;
  sendMessage(prompt: string): Promise<void>;
}

export interface RelayConfig {
  cdpUrl: string;
  conversationA: string;
  conversationB: string;
  maxTotalTurns: number;
  maxConsecutiveErrors: number;
  turnTimeoutMs: number;
  responseStableMs: number;
  pollIntervalMs: number;
  pendingRecoveryGraceMs: number;
  handoffMaxChars: number;
  wakePromptA: string;
  wakePromptB: string;
  checkpointDir: string;
}

export interface RelayStepResult {
  status: RelayStatus;
  action: 'wait' | 'triggered' | 'paused' | 'stopped' | 'terminal' | 'error';
  message?: string;
}

export const otherAgent = (agent: AgentName): AgentName => (agent === 'A' ? 'B' : 'A');

export const waitingStatusFor = (agent: AgentName): RelayStatus => (
  agent === 'A' ? 'WAITING_A' : 'WAITING_B'
);

export const triggerStatusFor = (agent: AgentName): RelayStatus => (
  agent === 'A' ? 'TRIGGER_A' : 'TRIGGER_B'
);
