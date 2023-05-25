"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.httpClient = httpClient;
const logger_1 = require("./logger");
class HttpError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`http error ${status}`);
        this.status = status;
        this.body = body;
        this.name = 'HttpError';
    }
}
exports.HttpError = HttpError;
function isRetryableStatus(status) {
    return status >= 500;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Exponential backoff starting at 100ms: 100, 200, 400, ... */
function backoffMs(attempt) {
    return 100 * 2 ** (attempt - 1);
}
function httpClient(opts) {
    const retries = opts.retries ?? 2;
    const timeoutMs = opts.timeoutMs ?? 5000;
    async function parseBody(res) {
        const text = await res.text();
        if (!text)
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    async function attempt(method, url, body, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = {
                'content-type': 'application/json',
                ...init?.headers,
            };
            const traceId = (0, logger_1.getTraceId)();
            if (traceId)
                headers['x-trace-id'] = traceId;
            if (opts.getToken) {
                headers['authorization'] = `Bearer ${await opts.getToken()}`;
            }
            const res = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            if (!res.ok) {
                const parsed = await parseBody(res);
                throw new HttpError(res.status, parsed);
            }
            return (await parseBody(res));
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function request(method, path, body, init) {
        const url = new URL(path, opts.baseUrl).toString();
        let lastError;
        for (let n = 0; n <= retries; n++) {
            try {
                return await attempt(method, url, body, init);
            }
            catch (err) {
                lastError = err;
                const retryable = err instanceof HttpError ? isRetryableStatus(err.status) : true;
                if (!retryable || n === retries)
                    throw err;
                await delay(backoffMs(n + 1));
            }
        }
        throw lastError;
    }
    return {
        get(path, init) {
            return request('GET', path, undefined, init);
        },
        post(path, body, init) {
            return request('POST', path, body, init);
        },
        put(path, body, init) {
            return request('PUT', path, body, init);
        },
        patch(path, body, init) {
            return request('PATCH', path, body, init);
        },
    };
}
