export interface HttpClientOpts {
    baseUrl: string;
    /** Called for every request; result is sent as `Authorization: Bearer <token>`. */
    getToken?: () => Promise<string>;
    /** Retries for 5xx responses and network errors. Default 2. */
    retries?: number;
    /** Per-attempt timeout in ms. Default 5000. */
    timeoutMs?: number;
}
export interface RequestInitLike {
    headers?: Record<string, string>;
}
export declare class HttpError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown);
}
export declare function httpClient(opts: HttpClientOpts): {
    get<T>(path: string, init?: RequestInitLike): Promise<T>;
    post<T>(path: string, body?: unknown, init?: RequestInitLike): Promise<T>;
    put<T>(path: string, body?: unknown, init?: RequestInitLike): Promise<T>;
    patch<T>(path: string, body?: unknown, init?: RequestInitLike): Promise<T>;
};
