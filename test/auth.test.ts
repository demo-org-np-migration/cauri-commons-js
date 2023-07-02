import { beforeAll, describe, expect, it, vi } from 'vitest';
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
