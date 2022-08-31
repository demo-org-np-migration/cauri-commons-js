import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';

/**
 * Every service that adopts this logger gets JSON-to-stdout for free, with
 * `service` and `env` baked into every line (see las convenciones internas de API: "Logs").
 *
 * `trace_id` is threaded through an AsyncLocalStorage so a request handled by
 * `createJwtAuth().express()` (or `.fastify()`) can hand its trace id to
 * every log line and every outgoing `httpClient` call for that request,
 * without passing it explicitly through every function signature.
 */

interface TraceContext {
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

/** Runs `fn` with `traceId` available to `getTraceId()` for its whole call stack. */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}

/** Current trace id, if `runWithTraceId` is active up the call stack. */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

export function logger(service: string, env: string): Logger {
  return pino({
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
      log(object) {
        const traceId = getTraceId();
        return {
          service,
          env,
          ...object,
          ...(traceId ? { trace_id: traceId } : {}),
        };
      },
    },
  });
}
