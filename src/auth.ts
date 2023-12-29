import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { importJWK, jwtVerify, type JWK, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { runWithTraceId } from './logger';

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuthUser {
  sub: string;
  roles: string[];
  merchant_id?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface CreateJwtAuthOpts {
  /** Realm issuer, e.g. `http://keycloak.platform.svc:8080/realms/cauri-staging`. */
  issuer: string;
  audience?: string;
}

function extractUser(payload: JWTPayload): AuthUser {
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  const roles = realmAccess?.roles ?? (payload.roles as string[] | undefined) ?? [];
  return {
    sub: String(payload.sub),
    roles,
    merchant_id: payload.merchant_id as string | undefined,
  };
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

function unauthorizedBody(message: string) {
  return { error: { code: 'unauthorized', message } };
}

function forbiddenBody(role: string) {
  return { error: { code: 'forbidden', message: `missing role ${role}` } };
}

/**
 * Works as an Express `RequestHandler` (req, res, next) or a Fastify
 * preHandler (request, reply). Both frameworks expose `.user` on the first
 * argument (set by `express()`/`fastify()` above) and a way to send a JSON
 * body with a status code on the second, so one implementation covers both.
 */
function requireRoleGuard(role: string) {
  return (reqOrRequest: Request | FastifyRequest, resOrReply: Response | FastifyReply, next?: NextFunction) => {
    const user = (reqOrRequest as { user?: AuthUser }).user;
    if (user?.roles.includes(role)) {
      next?.();
      return;
    }

    const res = resOrReply as Response;
    const reply = resOrReply as FastifyReply;
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
export function createJwtAuth(opts: CreateJwtAuthOpts) {
  const jwksUrl = `${opts.issuer}/protocol/openid-connect/certs`;
  let cachedKeys: JWK[] | undefined;
  let cachedAt = 0;

  async function getJwks(): Promise<JWK[]> {
    if (cachedKeys && Date.now() - cachedAt < JWKS_CACHE_TTL_MS) {
      return cachedKeys;
    }
    const res = await fetch(jwksUrl);
    if (!res.ok) {
      throw new Error(`failed to fetch JWKS from ${jwksUrl}: ${res.status}`);
    }
    const body = (await res.json()) as { keys: JWK[] };
    cachedKeys = body.keys;
    cachedAt = Date.now();
    return cachedKeys;
  }

  const getKey: JWTVerifyGetKey = async (header) => {
    const keys = await getJwks();
    const match = keys.find((k) => !header.kid || k.kid === header.kid) ?? keys[0];
    if (!match) throw new Error(`no matching JWK for kid ${header.kid ?? '(none)'}`);
    return importJWK(match, header.alg);
  };

  async function verify(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    return extractUser(payload);
  }

  function express(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const token = bearerToken(req.headers.authorization);
      if (!token) {
        res.status(401).json(unauthorizedBody('missing bearer token'));
        return;
      }

      const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
      runWithTraceId(traceId, () => {
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

  function fastify(): FastifyPluginAsync {
    return async (instance) => {
      instance.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const token = bearerToken(request.headers.authorization);
        if (!token) {
          reply.code(401).send(unauthorizedBody('missing bearer token'));
          return;
        }

        const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();
        await runWithTraceId(traceId, async () => {
          try {
            request.user = await verify(token);
          } catch {
            reply.code(401).send(unauthorizedBody('invalid token'));
          }
        });
      });
    };
  }

  /**
   * Guards a route to a role, e.g. `app.post('/x', auth.requireRole('ops-admin'), handler)`
   * (Express) or `{ preHandler: auth.requireRole('ops-admin') }` (Fastify).
   * Must run after `express()`/`fastify()` so `.user` is already set.
   */
  function requireRole(role: string): RequestHandler {
    return requireRoleGuard(role) as RequestHandler;
  }

  return { express, fastify, requireRole };
}
