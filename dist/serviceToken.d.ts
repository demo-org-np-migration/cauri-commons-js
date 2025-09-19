export interface ServiceTokenProviderOpts {
    /** Realm issuer, e.g. `http://keycloak.platform.svc:8080/realms/cauri-staging`. */
    issuer: string;
    clientId: string;
    clientSecret: string;
}
/**
 * Client-credentials grant against Keycloak (las convenciones internas de API, "auth entre
 * servicios"). `getToken()` caches the token until it's close to expiring,
 * then transparently fetches a new one.
 */
export declare function serviceTokenProvider(opts: ServiceTokenProviderOpts): {
    getToken(): Promise<string>;
};
