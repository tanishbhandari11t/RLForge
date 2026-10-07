interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    __RLFORGE_ASSETS__?: { mark: string; logo: string };
  }
}

const api: VsCodeApi =
  window.acquireVsCodeApi?.() ?? {
    postMessage: (m) => console.log('[rlforge → host]', m),
    getState: () => undefined,
    setState: () => undefined,
  };

export class RequestError extends Error {
  constructor(message: string, readonly traceback?: string) {
    super(message);
  }
}

type Listener = (message: any) => void;

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Set<Listener>();

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.type === 'response') {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.ok) {
        p.resolve(msg.result);
      } else {
        p.reject(new RequestError(msg.error, msg.traceback));
      }
    }
    return;
  }
  listeners.forEach((l) => l(msg));
});

/** Send a command to the engine (or, for `ui:*` commands, to the extension host). */
export function request<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    api.postMessage({ type: 'request', id, cmd, args });
  });
}

export function onHostMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyReady(): void {
  api.postMessage({ type: 'ready' });
}

export const assets = window.__RLFORGE_ASSETS__ ?? { mark: '', logo: '' };

export function persisted<T>(): Partial<T> {
  return (api.getState() as Partial<T>) ?? {};
}

export function persist<T>(state: T): void {
  api.setState(state);
}
