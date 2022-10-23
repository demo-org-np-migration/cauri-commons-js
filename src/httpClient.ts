import { getTraceId } from './logger';

export interface HttpClientOpts {
  baseUrl: string;
  /** Called for every request; result is sent as `Authorization: Bearer <token>`. */
  getToken?: () => Promise<string>;
  /** Retries for 5xx responses and network errors. Default 2. */
  retries?: number;
  /** Per-attempt timeout in ms. Default 5000. */
  timeoutMs?: number;
}

export interface RequestInitLike {
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`http error ${status}`);
    this.name = 'HttpError';
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff starting at 100ms: 100, 200, 400, ... */
function backoffMs(attempt: number): number {
  return 100 * 2 ** (attempt - 1);
}

export function httpClient(opts: HttpClientOpts) {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 5000;

  async function parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function attempt<T>(method: string, url: string, body: unknown, init?: RequestInitLike): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...init?.headers,
      };
      const traceId = getTraceId();
      if (traceId) headers['x-trace-id'] = traceId;
      if (opts.getToken) {
        headers['authorization'] = `Bearer ${await opts.getToken()}`;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const parsed = await parseBody(res);
        throw new HttpError(res.status, parsed);
      }
      return (await parseBody(res)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(method: string, path: string, body?: unknown, init?: RequestInitLike): Promise<T> {
    const url = new URL(path, opts.baseUrl).toString();
    let lastError: unknown;

    for (let n = 0; n <= retries; n++) {
      try {
        return await attempt<T>(method, url, body, init);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof HttpError ? isRetryableStatus(err.status) : true;
        if (!retryable || n === retries) throw err;
        await delay(backoffMs(n + 1));
      }
    }
    throw lastError;
  }

  return {
    get<T>(path: string, init?: RequestInitLike) {
      return request<T>('GET', path, undefined, init);
    },
    post<T>(path: string, body?: unknown, init?: RequestInitLike) {
      return request<T>('POST', path, body, init);
    },
    put<T>(path: string, body?: unknown, init?: RequestInitLike) {
      return request<T>('PUT', path, body, init);
    },
    patch<T>(path: string, body?: unknown, init?: RequestInitLike) {
      return request<T>('PATCH', path, body, init);
    },
  };
}
