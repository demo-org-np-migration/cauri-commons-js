"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJwtAuth = createJwtAuth;
const node_crypto_1 = require("node:crypto");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
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
function forbiddenBody(role) {
    return { error: { code: 'forbidden', message: `missing role ${role}` } };
}
/**
 * Works as an Express `RequestHandler` (req, res, next) or a Fastify
 * preHandler (request, reply). Both frameworks expose `.user` on the first
 * argument (set by `express()`/`fastify()` above) and a way to send a JSON
 * body with a status code on the second, so one implementation covers both.
 */
function requireRoleGuard(role) {
    return (reqOrRequest, resOrReply, next) => {
        const user = reqOrRequest.user;
        if (user?.roles.includes(role)) {
            next?.();
            return;
        }
        const res = resOrReply;
        const reply = resOrReply;
        if (typeof res.status === 'function' && typeof res.json === 'function') {
            res.status(403).json(forbiddenBody(role));
            return;
        }
        reply.code(403).send(forbiddenBody(role));
    };
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
    function fastify() {
        // Plain Fastify plugins are encapsulated: a hook added inside one only
        // applies to routes declared in that SAME plugin, not to siblings
        // registered next to it (the natural way to compose an app: one
        // `register` for auth, another for routes). fastify-plugin breaks that
        // encapsulation so this hook attaches to the parent context instead,
        // which is what every consumer actually wants from an auth plugin.
        return (0, fastify_plugin_1.default)(async (instance) => {
            instance.addHook('onRequest', async (request, reply) => {
                const token = bearerToken(request.headers.authorization);
                if (!token) {
                    reply.code(401).send(unauthorizedBody('missing bearer token'));
                    return;
                }
                const traceId = request.headers['x-trace-id'] ?? (0, node_crypto_1.randomUUID)();
                await (0, logger_1.runWithTraceId)(traceId, async () => {
                    try {
                        request.user = await verify(token);
                    }
                    catch {
                        reply.code(401).send(unauthorizedBody('invalid token'));
                    }
                });
            });
        }, { name: '@cauri/commons/auth' });
    }
    /**
     * Guards a route to a role, e.g. `app.post('/x', auth.requireRole('ops-admin'), handler)`
     * (Express) or `{ preHandler: auth.requireRole('ops-admin') }` (Fastify).
     * Must run after `express()`/`fastify()` so `.user` is already set.
     */
    function requireRole(role) {
        return requireRoleGuard(role);
    }
    return { express, fastify, requireRole };
}
