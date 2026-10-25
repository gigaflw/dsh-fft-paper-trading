import type { DataSourceStatus, RpcResult } from '../contract.js';
import type { PaperService } from './paper-service.js';
export type PaperRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
export interface PaperRpcOptions {
    /** Read-only data-source state for the panel header; absent means no service. */
    dataSource?: () => Promise<DataSourceStatus>;
}
export declare function createPaperRpcHandler(service: PaperService, options?: PaperRpcOptions): PaperRpcHandler;
//# sourceMappingURL=rpc.d.ts.map