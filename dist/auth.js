"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJwtAuth = createJwtAuth;
const node_crypto_1 = require("node:crypto");
const jose_1 = require("jose");
const logger_1 = require("./logger");
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
function extractUser(payload) {
    const realmAccess = payload.realm_access;
    const roles = realmAccess?.roles ?? payload.roles ?? [];
    return {
        sub: String(payload.sub),
        roles,
        merchant_id: payload.merchant_id,
    };
}
function bearerToken(header) {
    if (!header?.startsWith('Bearer '))
        return undefined;
    return header.slice('Bearer '.length);
}
function unauthorizedBody(message) {
    return { error: { code: 'unauthorized', message } };
}
/**
 * Validates JWTs issued by a Keycloak realm against its JWKS (las convenciones internas de API).
 * `express()`/`fastify()` set `req.user`/`request.user` to `{sub, roles, merchant_id?}`
 * and reject with 401 when there's no valid token.
 */
function createJwtAuth(opts) {
    const jwksUrl = `${opts.issuer}/protocol/openid-connect/certs`;
    let cachedKeys;
    let cachedAt = 0;
    async function getJwks() {
        if (cachedKeys && Date.now() - cachedAt < JWKS_CACHE_TTL_MS) {
            return cachedKeys;
        }
        const res = await fetch(jwksUrl);
        if (!res.ok) {
            throw new Error(`failed to fetch JWKS from ${jwksUrl}: ${res.status}`);
        }
        const body = (await res.json());
        cachedKeys = body.keys;
        cachedAt = Date.now();
        return cachedKeys;
    }
    const getKey = async (header) => {
        const keys = await getJwks();
        const match = keys.find((k) => !header.kid || k.kid === header.kid) ?? keys[0];
        if (!match)
            throw new Error(`no matching JWK for kid ${header.kid ?? '(none)'}`);
        return (0, jose_1.importJWK)(match, header.alg);
    };
    async function verify(token) {
        const { payload } = await (0, jose_1.jwtVerify)(token, getKey, {
            issuer: opts.issuer,
            audience: opts.audience,
        });
        return extractUser(payload);
    }
    function express() {
        return (req, res, next) => {
            const token = bearerToken(req.headers.authorization);
            if (!token) {
                res.status(401).json(unauthorizedBody('missing bearer token'));
                return;
            }
            const traceId = req.headers['x-trace-id'] ?? (0, node_crypto_1.randomUUID)();
            (0, logger_1.runWithTraceId)(traceId, () => {
                verify(token)
                    .then((user) => {
                    req.user = user;
                    next();
                })
                    .catch(() => {
                    res.status(401).json(unauthorizedBody('invalid token'));
                });
            });
        };
    }
    return { express };
}
