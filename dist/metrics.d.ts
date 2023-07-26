import type { RequestHandler } from 'express';
import { Registry } from 'prom-client';
/**
 * Default process metrics (CPU, memory, event loop lag) plus an
 * `http_request_duration_seconds` histogram, in the Prometheus text format
 * `GET /metrics` is expected to serve (las convenciones internas de API).
 */
export declare function metrics(): {
    registry: Registry<"text/plain; version=0.0.4; charset=utf-8">;
    handler: () => RequestHandler;
};
