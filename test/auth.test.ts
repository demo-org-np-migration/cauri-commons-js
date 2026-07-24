import { beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createJwtAuth } from '../src/auth';

const ISSUER = 'http://keycloak.platform.svc:8080/realms/cauri-staging';

let validToken: string;
let publicJwk: Record<string, unknown>;

function fakeReqRes(headers: Record<string, string> = {}) {
  const req: any = { headers };
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return { req, res };
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  validToken = await new SignJWT({ realm_access: { roles: ['customer'] } })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setSubject('aaaaaaaa-0000-4000-8000-000000000001')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/protocol/openid-connect/certs')) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }),
  );
});

describe('createJwtAuth().express()', () => {
  it('returns 401 when there is no bearer token', () => {
    const middleware = createJwtAuth({ issuer: ISSUER }).express();
    const { req, res } = fakeReqRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user from a valid token and calls next()', async () => {
    const middleware = createJwtAuth({ issuer: ISSUER }).express();
    const { req, res } = fakeReqRes({ authorization: `Bearer ${validToken}` });

    await new Promise<void>((resolve) => {
      middleware(req, res, () => resolve());
    });

    expect(req.user).toEqual({
      sub: 'aaaaaaaa-0000-4000-8000-000000000001',
      roles: ['customer'],
      merchant_id: undefined,
    });
  });

  it('returns 401 for a token signed by someone else', async () => {
    const { privateKey: rogueKey } = await generateKeyPair('RS256');
    const rogueToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setSubject('someone')
      .setExpirationTime('1h')
      .sign(rogueKey);

    const middleware = createJwtAuth({ issuer: ISSUER }).express();
    const { req, res } = fakeReqRes({ authorization: `Bearer ${rogueToken}` });
    const next = vi.fn();

    await new Promise<void>((resolve) => {
      middleware(req, res, next);
      setTimeout(resolve, 10);
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('createJwtAuth().fastify()', () => {
  function fakeFastifyRequestReply(headers: Record<string, string> = {}) {
    const request: any = { headers };
    const reply: any = {
      statusCode: 0,
      body: undefined,
      code(status: number) {
        this.statusCode = status;
        return this;
      },
      send(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return { request, reply };
  }

  async function registerAndRunHook(plugin: ReturnType<typeof createJwtAuth>['fastify'], request: any, reply: any) {
    let onRequestHook: ((req: any, rep: any) => Promise<void>) | undefined;
    const instance: any = {
      addHook(name: string, fn: (req: any, rep: any) => Promise<void>) {
        if (name === 'onRequest') onRequestHook = fn;
      },
    };
    await plugin()(instance, {}, () => undefined);
    await onRequestHook!(request, reply);
  }

  it('returns 401 when there is no bearer token', async () => {
    const auth = createJwtAuth({ issuer: ISSUER });
    const { request, reply } = fakeFastifyRequestReply();

    await registerAndRunHook(auth.fastify, request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.user).toBeUndefined();
  });

  it('sets request.user from a valid token', async () => {
    const auth = createJwtAuth({ issuer: ISSUER });
    const { request, reply } = fakeFastifyRequestReply({ authorization: `Bearer ${validToken}` });

    await registerAndRunHook(auth.fastify, request, reply);

    expect(request.user).toEqual({
      sub: 'aaaaaaaa-0000-4000-8000-000000000001',
      roles: ['customer'],
      merchant_id: undefined,
    });
  });
});

describe('createJwtAuth().fastify() on a real Fastify app', () => {
  // Reproduces the bug reported from kyc-service: the natural usage pattern
  // registers auth.fastify() and the route plugins as siblings under the
  // same parent (e.g. two `await app.register(...)` calls, or one wrapping
  // `register` with two children). Fastify encapsulates each `register`
  // call in its own context, so a plain plugin's onRequest hook only runs
  // for routes declared inside that SAME plugin unless it's wrapped with
  // fastify-plugin. Without that wrapping this test fails: the sibling
  // route is served with no auth at all.
  it('applies the onRequest hook to a route registered as a sibling plugin', async () => {
    const app = Fastify();
    const auth = createJwtAuth({ issuer: ISSUER });

    await app.register(auth.fastify());
    await app.register(async (instance) => {
      instance.get('/v1/protected', async () => ({ ok: true }));
    });

    const noToken = await app.inject({ method: 'GET', url: '/v1/protected' });
    expect(noToken.statusCode).toBe(401);

    const withToken = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(withToken.statusCode).toBe(200);
    expect(withToken.json()).toEqual({ ok: true });

    await app.close();
  });
});

describe('createJwtAuth().requireRole()', () => {
  it('calls next() when the user has the role', () => {
    const requireRole = createJwtAuth({ issuer: ISSUER }).requireRole('ops-admin');
    const { req, res } = fakeReqRes();
    req.user = { sub: 'carla', roles: ['ops', 'ops-admin'] };
    const next = vi.fn();

    requireRole(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('returns 403 when the user is missing the role', () => {
    const requireRole = createJwtAuth({ issuer: ISSUER }).requireRole('ops-admin');
    const { req, res } = fakeReqRes();
    req.user = { sub: 'ana', roles: ['customer'] };
    const next = vi.fn();

    requireRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { code: 'forbidden', message: 'missing role ops-admin' } });
  });

  it('returns 403 when there is no user at all', () => {
    const requireRole = createJwtAuth({ issuer: ISSUER }).requireRole('ops-admin');
    const { req, res } = fakeReqRes();
    const next = vi.fn();

    requireRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
