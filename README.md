# @cauri/commons

Librería compartida de Node para los servicios de Cauri. Nació porque cada repo logueaba
distinto y era un dolor de cabeza correlacionar nada en Grafana/Loki. Después fuimos
sumando lo que todos los servicios necesitan igual: validar el JWT de Keycloak, pegarle a
otro servicio con reintentos, exponer métricas para Prometheus.

Si tu servicio habla HTTP en Cauri, probablemente esta lib te ahorra escribir de nuevo
media docena de cosas.

## Instalación

No está en un registry privado, se instala directo del repo:

```json
{
  "dependencies": {
    "@cauri/commons": "github:demo-org-np-migration/cauri-commons-js#v1.2.0"
  }
}
```

Importante: como es una dependencia git, `npm install` **no** corre ningún build (no hay
`prepare` script, y aunque lo hubiera, no queremos depender de que el consumidor tenga
`devDependencies` de esta lib). Por eso `dist/` está commiteado en el repo, y cada tag
tiene el `dist/` correspondiente a esa versión. Si tocás `src/`, corré `npm run build`
antes de commitear.

## Uso

### Logger

```ts
import { logger } from '@cauri/commons';

const log = logger('payments-api', process.env.ENV ?? 'staging');
log.info({ payment_id: p.id }, 'payment created');
```

Saca JSON a stdout con `service`, `env` y (si estás dentro de un request autenticado con
`createJwtAuth`) `trace_id`, como pide la sección de logs del contrato. No hace falta
pasarle el trace id a mano: `express()`/`fastify()` ya corren tu handler dentro de
`runWithTraceId`, así que cualquier log o llamada con `httpClient` que hagas durante ese
request lo hereda solo.

### Auth (Keycloak)

```ts
import { createJwtAuth } from '@cauri/commons';

const auth = createJwtAuth({
  issuer: process.env.KEYCLOAK_ISSUER!, // http://keycloak.platform.svc:8080/realms/cauri-staging
});

// Express
app.use('/v1', auth.express());
app.get('/v1/accounts/:id', (req, res) => {
  // req.user = { sub, roles, merchant_id? }
});

// Fastify
await app.register(auth.fastify());
app.get('/v1/accounts/:id', async (request) => {
  // request.user = { sub, roles, merchant_id? }
});

// Restringir por rol (agregado en 1.2.0)
app.post('/backoffice/accounts/:id/freeze', auth.requireRole('ops-admin'), handler);
```

Sin token válido devuelve `401` con el shape de error del contrato
(`{"error":{"code":"unauthorized","message":"..."}}`). La JWKS se resuelve contra
`<issuer>/protocol/openid-connect/certs` y se cachea unos minutos, no la pedimos en cada
request.

### HTTP client

```ts
import { httpClient } from '@cauri/commons';

const ledger = httpClient({
  baseUrl: 'http://ledger-core.staging.svc:8080',
  getToken: () => serviceToken.getToken(),
  retries: 2,
  timeoutMs: 5000,
});

const account = await ledger.get(`/v1/accounts/${id}`);
await ledger.post('/v1/ledger/transfers', { from_account, to_account, amount, currency, reference });
```

Reintenta con backoff exponencial (100ms, 200ms, 400ms...) los `5xx` y los errores de red;
un `4xx` no se reintenta, se tira tal cual como `HttpError`. Si venís de un handler armado
con `createJwtAuth`, el `trace_id` viaja solo en el header `x-trace-id`.

### Service token provider (agregado en 1.2.0)

Para llamadas de servicio a servicio con client credentials:

```ts
import { serviceTokenProvider } from '@cauri/commons';

const serviceToken = serviceTokenProvider({
  issuer: process.env.KEYCLOAK_ISSUER!,
  clientId: process.env.KEYCLOAK_CLIENT_ID!,
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
});

await serviceToken.getToken(); // cachea hasta que expira, después pide uno nuevo
```

### Métricas (agregado en 1.1.0)

```ts
import { metrics } from '@cauri/commons';

const { handler, registry } = metrics();
app.get('/metrics', handler());
```

Expone las métricas default de proceso de `prom-client` más un histograma
`http_request_duration_seconds` con labels `method`, `route`, `status_code`.

## Desarrollo local

```bash
npm install
npm test          # vitest
npm run build     # regenera dist/, tiene que quedar sin diff antes de commitear
```

El CI corre `npm test` y `npm run build`, y falla si `dist/` queda con diff — significa
que alguien tocó `src/` y no corrió el build.

## Versiones

| Versión | Qué trae |
|---|---|
| `v1.0.0` | `logger`, `httpClient`, `createJwtAuth().express()` |
| `v1.1.0` | agrega `createJwtAuth().fastify()` y `metrics()` |
| `v1.2.0` | agrega `serviceTokenProvider` y `createJwtAuth().requireRole()`; migrar desde 1.1 no rompe nada |

Dueño: equipo platform. Preguntas o breaking changes, hablar con Martín o Carla antes de
mergear.
