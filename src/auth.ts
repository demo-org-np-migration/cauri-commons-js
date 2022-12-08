import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { runWithTraceId } from './logger';

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

/**
 * Validates JWTs issued by a Keycloak realm against its JWKS (las convenciones internas de API).
 * `express()`/`fastify()` set `req.user`/`request.user` to `{sub, roles, merchant_id?}`
 * and reject with 401 when there's no valid token.
 */
export function createJwtAuth(opts: CreateJwtAuthOpts) {
  const jwks = createRemoteJWKSet(new URL(`${opts.issuer}/protocol/openid-connect/certs`));

  async function verify(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, jwks, {
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

  return { express };
}
