"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metrics = metrics;
const prom_client_1 = require("prom-client");
/**
 * Default process metrics (CPU, memory, event loop lag) plus an
 * `http_request_duration_seconds` histogram, in the Prometheus text format
 * `GET /metrics` is expected to serve (las convenciones internas de API).
 */
function metrics() {
    const registry = new prom_client_1.Registry();
    (0, prom_client_1.collectDefaultMetrics)({ register: registry });
    const httpRequestDuration = new prom_client_1.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        registers: [registry],
    });
    /**
     * Mount once, before your routes: `app.use(metrics().handler())`. Times
     * every request into `http_request_duration_seconds`, and short-circuits
     * `GET /metrics` to serve the registry in Prometheus text format
     * (las convenciones internas de API).
     */
    function handler() {
        return (req, res, next) => {
            if (req.path === '/metrics') {
                registry
                    .metrics()
                    .then((body) => {
                    res.setHeader('content-type', registry.contentType);
                    res.status(200).send(body);
                })
                    .catch(next);
                return;
            }
            const end = httpRequestDuration.startTimer({ method: req.method });
            res.once('finish', () => {
                end({ route: req.route?.path ?? req.path, status_code: String(res.statusCode) });
            });
            next();
        };
    }
    return { registry, handler };
}
