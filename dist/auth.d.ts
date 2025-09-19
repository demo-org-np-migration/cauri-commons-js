import type { RequestHandler } from 'express';
import type { FastifyPluginAsync } from 'fastify';
export interface AuthUser {
    sub: string;
    roles: string[];
    merchant_id?: string;
}
declare global {
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
/**
 * Validates JWTs issued by a Keycloak realm against its JWKS (las convenciones internas de API).
 * `express()`/`fastify()` set `req.user`/`request.user` to `{sub, roles, merchant_id?}`
 * and reject with 401 when there's no valid token.
 */
export declare function createJwtAuth(opts: CreateJwtAuthOpts): {
    express: () => RequestHandler;
    fastify: () => FastifyPluginAsync;
    requireRole: (role: string) => RequestHandler;
};
