import {WebSocket} from 'undici';

export interface ChromeTarget {
  id: string;
  type: string;
  url: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

export class CdpError extends Error {
  constructor(message: string, public readonly method?: string) {
    super(message);
    this.name = 'CdpError';
  }
}

interface CdpResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {code?: number; message?: string; data?: unknown};
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
};

const decodeMessage = async (data: unknown): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'function') {
    return String(await data.text());
  }
  throw new CdpError('Unsupported CDP WebSocket message type');
};

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private closed = false;

  private constructor(private readonly socket: WebSocket, private readonly callTimeoutMs = 30_000) {}

  static async connect(webSocketDebuggerUrl: string, callTimeoutMs = 30_000): Promise<CdpClient> {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const client = new CdpClient(socket, callTimeoutMs);
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event: Event) => {
        cleanup();
        reject(new CdpError(`Unable to connect to Chrome target: ${event.type}`));
      };
      const cleanup = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
    socket.addEventListener('message', (event) => {
      void client.handleMessage(event.data);
    });
    socket.addEventListener('close', () => client.handleClose('Chrome target connection closed'));
    socket.addEventListener('error', () => client.handleClose('Chrome target connection failed'));
    return client;
  }

  private async handleMessage(data: unknown) {
    try {
      const message = JSON.parse(await decodeMessage(data)) as CdpResponse;
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new CdpError(
          `${message.error.message ?? 'CDP command failed'}${message.error.data ? `: ${JSON.stringify(message.error.data)}` : ''}`,
          pending.method,
        ));
        return;
      }
      pending.resolve(message.result);
    } catch (error) {
      this.handleClose(`Invalid CDP message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleClose(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new CdpError(reason, pending.method));
      this.pending.delete(id);
    }
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      throw new CdpError('Chrome target is not connected', method);
    }
    const id = this.nextId++;
    const payload = JSON.stringify({id, method, params: params ?? {}});
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP command timed out after ${this.callTimeoutMs}ms`, method));
      }, this.callTimeoutMs);
      this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject, timer, method});
      try {
        this.socket.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError(`Unable to send CDP command: ${error instanceof Error ? error.message : String(error)}`, method));
      }
    });
  }

  async evaluate<T = unknown>(expression: string, returnByValue = true): Promise<T> {
    const result = await this.call<{result?: {value?: T; description?: string; subtype?: string; type?: string}}>(
      'Runtime.evaluate',
      {expression, awaitPromise: true, returnByValue, userGesture: true},
    );
    const remote = result.result;
    if (!remote) throw new CdpError('Runtime.evaluate returned no result', 'Runtime.evaluate');
    if (remote.subtype === 'error' || remote.type === 'object' && remote.description?.startsWith('Error')) {
      throw new CdpError(remote.description ?? 'Page evaluation failed', 'Runtime.evaluate');
    }
    return remote.value as T;
  }

  async close() {
    if (this.closed) return;
    this.handleClose('Chrome target connection closed');
    this.socket.close();
  }
}

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}`;
  } catch {
    return value.trim().replace(/\/$/, '');
  }
};

export const listChromeTargets = async (cdpUrl: string): Promise<ChromeTarget[]> => {
  const endpoint = new URL('/json/list', cdpUrl).toString();
  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    throw new CdpError(`Unable to reach Chrome CDP at ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new CdpError(`Chrome CDP returned HTTP ${response.status} for ${endpoint}`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new CdpError('Chrome CDP /json/list returned an invalid target list');
  return value.filter((target): target is ChromeTarget => (
    Boolean(target)
    && typeof target === 'object'
    && (target as ChromeTarget).type === 'page'
    && typeof (target as ChromeTarget).id === 'string'
    && typeof (target as ChromeTarget).url === 'string'
    && typeof (target as ChromeTarget).webSocketDebuggerUrl === 'string'
  ));
};

export const targetMatches = (locator: string, targetUrl: string) => (
  normalizeUrl(locator) === normalizeUrl(targetUrl)
);

export const selectChatTargets = (
  targets: ChromeTarget[],
  conversationA: string,
  conversationB: string,
) => {
  const find = (locator: string, agent: string) => {
    const match = targets.find((target) => targetMatches(locator, target.url));
    if (!match) throw new CdpError(`Chat ${agent} page not found for locator ${locator}`);
    return match;
  };
  const targetA = find(conversationA, 'A');
  const targetB = find(conversationB, 'B');
  if (targetA.id === targetB.id) throw new CdpError('conversationA and conversationB resolve to the same Chrome page');
  return {A: targetA, B: targetB};
};
