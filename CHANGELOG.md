# Changelog

## v1.0.0

- `logger(service, env)`: JSON a stdout con `service`/`env`, correlación de `trace_id`.
- `httpClient(opts)`: `get/post/put/patch` con reintentos en `5xx`/errores de red y backoff
  exponencial, propaga `trace_id`.
- `createJwtAuth(opts).express()`: valida JWT de Keycloak, `401` sin token válido, deja
  `req.user`.
