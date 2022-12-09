import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, httpClient } from '../src/httpClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpClient', () => {
  it('performs a GET and parses the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({ baseUrl: 'http://accounts-api.staging.svc:8080' });
    const result = await client.get<{ ok: boolean }>('/v1/accounts/123');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://accounts-api.staging.svc:8080/v1/accounts/123');
    expect(init.method).toBe('GET');
  });

  it('sends a JSON body on POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({ baseUrl: 'http://payments-api.staging.svc:8080' });
    await client.post('/v1/payments', { from_account: 'a', to_account: 'b', amount: '10.00' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ from_account: 'a', to_account: 'b', amount: '10.00' });
  });

  it('adds an Authorization header when getToken is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({
      baseUrl: 'http://ledger-core.staging.svc:8080',
      getToken: async () => 'service-token-abc',
    });
    await client.get('/v1/customers/1');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer service-token-abc');
  });

  it('retries a 5xx response and succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({ baseUrl: 'http://cards-api.staging.svc:8080', retries: 2 });
    const result = await client.get<{ ok: boolean }>('/v1/cards/1');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response and throws HttpError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'insufficient_funds', message: 'nope' } }), { status: 422 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({ baseUrl: 'http://ledger-core.staging.svc:8080', retries: 2 });

    await expect(client.post('/v1/ledger/transfers', {})).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries on repeated 5xx', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpClient({ baseUrl: 'http://cards-api.staging.svc:8080', retries: 1 });

    await expect(client.get('/v1/cards/1')).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
