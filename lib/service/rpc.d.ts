import type { RpcResult } from '../contract.js';
import type { PaperService } from './paper-service.js';
export type PaperRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
export declare function createPaperRpcHandler(service: PaperService): PaperRpcHandler;
//# sourceMappingURL=rpc.d.ts.map