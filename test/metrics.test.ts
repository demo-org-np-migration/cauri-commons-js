import { describe, expect, it, vi } from 'vitest';
import { metrics } from '../src/metrics';

function fakeReqRes(path: string, method = 'GET') {
  const listeners: Record<string, () => void> = {};
  const req: any = { path, method, route: undefined };
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    once(event: string, cb: () => void) {
      listeners[event] = cb;
    },
    emit(event: string) {
      listeners[event]?.();
    },
  };
  return { req, res };
}

describe('metrics()', () => {
  it('serves the registry as Prometheus text on GET /metrics', async () => {
    const { handler, registry } = metrics();
    const { req, res } = fakeReqRes('/metrics');
    const next = vi.fn();

    handler()(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(registry.contentType);
    expect(String(res.body)).toContain('http_request_duration_seconds');
  });

  it('times other requests and records them on finish', async () => {
    const { handler, registry } = metrics();
    const { req, res } = fakeReqRes('/v1/payments', 'POST');
    const next = vi.fn();

    handler()(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit('finish');

    const text = await registry.metrics();
    expect(text).toContain('http_request_duration_seconds_count{method="POST"');
  });
});
