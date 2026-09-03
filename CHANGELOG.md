# Changelog

## v1.2.1

- `fastify()`: el hook de auth se aplica al contexto padre (fastify-plugin). Sin esto,
  registrar `auth.fastify()` y las rutas como plugins hermanos (el patrón más natural,
  ej. `app.register(auth.fastify()); app.register(routes)`) dejaba las rutas sin auth: el
  hook `onRequest` quedaba encapsulado dentro del plugin de auth y nunca corría para las
  rutas hermanas. Reportado desde kyc-service.

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
