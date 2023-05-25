"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithTraceId = runWithTraceId;
exports.getTraceId = getTraceId;
exports.logger = logger;
const node_async_hooks_1 = require("node:async_hooks");
const pino_1 = __importDefault(require("pino"));
const traceStorage = new node_async_hooks_1.AsyncLocalStorage();
/** Runs `fn` with `traceId` available to `getTraceId()` for its whole call stack. */
function runWithTraceId(traceId, fn) {
    return traceStorage.run({ traceId }, fn);
}
/** Current trace id, if `runWithTraceId` is active up the call stack. */
function getTraceId() {
    return traceStorage.getStore()?.traceId;
}
function logger(service, env) {
    return (0, pino_1.default)({
        base: null,
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
        formatters: {
            level(label) {
                return { level: label };
            },
            log(object) {
                const traceId = getTraceId();
                return {
                    service,
                    env,
                    ...object,
                    ...(traceId ? { trace_id: traceId } : {}),
                };
            },
        },
    });
}
