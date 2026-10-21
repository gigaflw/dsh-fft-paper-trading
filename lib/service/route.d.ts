import { PAPER_ROUTE } from '../contract.js';
import type { PaperRpcHandler } from './rpc.js';
export interface PaperRoute {
    readonly path: typeof PAPER_ROUTE;
    readonly methods: readonly string[];
    readonly requestBody: 'buffered';
    readonly fetch: (request: Request) => Promise<Response>;
}
export interface HostFetchLike {
    register(route: PaperRoute): () => Promise<void>;
}
export interface HostConnectionLike {
    fetch: HostFetchLike;
}
/** Exact Fetch route behind `/api`, mirroring the settings-plugin pattern. */
export declare function createPaperRoute(handler: PaperRpcHandler): PaperRoute;
//# sourceMappingURL=route.d.ts.map