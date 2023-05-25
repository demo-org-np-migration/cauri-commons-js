import { type Logger } from 'pino';
/** Runs `fn` with `traceId` available to `getTraceId()` for its whole call stack. */
export declare function runWithTraceId<T>(traceId: string, fn: () => T): T;
/** Current trace id, if `runWithTraceId` is active up the call stack. */
export declare function getTraceId(): string | undefined;
export declare function logger(service: string, env: string): Logger;
