"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceTokenProvider = serviceTokenProvider;
/** Safety margin so we refresh slightly before the token actually expires. */
const EXPIRY_SKEW_MS = 5000;
/**
 * Client-credentials grant against Keycloak (las convenciones internas de API, "auth entre
 * servicios"). `getToken()` caches the token until it's close to expiring,
 * then transparently fetches a new one.
 */
function serviceTokenProvider(opts) {
    const tokenUrl = `${opts.issuer}/protocol/openid-connect/token`;
    let cached;
    let pending;
    async function fetchToken() {
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
        const json = (await res.json());
        return {
            token: json.access_token,
            expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS,
        };
    }
    return {
        async getToken() {
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
