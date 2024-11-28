# Changelog

## v1.2.0

- `serviceTokenProvider(opts)`: client-credentials contra Keycloak con cache hasta que el
  token está por expirar (usar para las llamadas de servicio a servicio, ej.
  `payments-api` → `ledger-core`).
- `createJwtAuth(opts).requireRole(role)`: guard reusable para Express y Fastify. `403`
  con `{"error":{"code":"forbidden", ...}}` si al usuario le falta el rol.
- Migrar desde 1.1 no rompe nada: `express()`, `fastify()` y `metrics()` quedan igual.

## v1.1.0

- `createJwtAuth(opts).fastify()`: mismo chequeo que `express()`, para servicios en
  Fastify. Deja `request.user`.
- `metrics()`: métricas default de proceso (`prom-client`) + histograma
  `http_request_duration_seconds`. `handler()` se monta con `app.use()` y responde
  `GET /metrics` en formato Prometheus.

## v1.0.0

- `logger(service, env)`: JSON a stdout con `service`/`env`, correlación de `trace_id`.
- `httpClient(opts)`: `get/post/put/patch` con reintentos en `5xx`/errores de red y backoff
  exponencial, propaga `trace_id`.
- `createJwtAuth(opts).express()`: valida JWT de Keycloak, `401` sin token válido, deja
  `req.user`.
