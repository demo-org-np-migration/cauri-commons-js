import { afterEach, describe, expect, it, vi } from 'vitest';
import { serviceTokenProvider } from '../src/serviceToken';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('serviceTokenProvider', () => {
  it('fetches a token with client-credentials and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'token-1', expires_in: 300 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = serviceTokenProvider({
      issuer: 'http://keycloak.platform.svc:8080/realms/cauri-staging',
      clientId: 'payments-api',
      clientSecret: 'secret',
    });

    const token1 = await provider.getToken();
    const token2 = await provider.getToken();

    expect(token1).toBe('token-1');
    expect(token2).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://keycloak.platform.svc:8080/realms/cauri-staging/protocol/openid-connect/token');
    expect(String(init.body)).toContain('grant_type=client_credentials');
  });

  it('fetches a new token once the cached one expires', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1', expires_in: 60 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-2', expires_in: 60 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = serviceTokenProvider({
      issuer: 'http://keycloak.platform.svc:8080/realms/cauri-staging',
      clientId: 'payments-api',
      clientSecret: 'secret',
    });

    await expect(provider.getToken()).resolves.toBe('token-1');
    vi.advanceTimersByTime(61_000);
    await expect(provider.getToken()).resolves.toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when Keycloak rejects the client credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })));

    const provider = serviceTokenProvider({
      issuer: 'http://keycloak.platform.svc:8080/realms/cauri-staging',
      clientId: 'payments-api',
      clientSecret: 'wrong',
    });

    await expect(provider.getToken()).rejects.toThrow(/401/);
  });
});
