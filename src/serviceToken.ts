export interface ServiceTokenProviderOpts {
  /** Realm issuer, e.g. `http://keycloak.platform.svc:8080/realms/cauri-staging`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Safety margin so we refresh slightly before the token actually expires. */
const EXPIRY_SKEW_MS = 5000;

/**
 * Client-credentials grant against Keycloak (las convenciones internas de API, "auth entre
 * servicios"). `getToken()` caches the token until it's close to expiring,
 * then transparently fetches a new one.
 */
export function serviceTokenProvider(opts: ServiceTokenProviderOpts) {
  const tokenUrl = `${opts.issuer}/protocol/openid-connect/token`;
  let cached: CachedToken | undefined;
  let pending: Promise<CachedToken> | undefined;

  async function fetchToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      throw new Error(`failed to fetch service token from ${tokenUrl}: ${res.status}`);
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    return {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS,
    };
  }

  return {
    async getToken(): Promise<string> {
      if (cached && Date.now() < cached.expiresAt) {
        return cached.token;
      }
      if (!pending) {
        pending = fetchToken().finally(() => {
          pending = undefined;
        });
      }
      cached = await pending;
      return cached.token;
    },
  };
}
