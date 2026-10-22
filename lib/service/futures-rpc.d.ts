/**
 * `futures/*` RPC endpoints, mounted on the same `/api/ft-paper-trading` route
 * as the stock endpoints. The endpoint list and payloads follow
 * `docs/specs/futures-mvp.md` §2 exactly.
 *
 * @module @ft/dsh-fft-paper-trading/service/futures-rpc
 */
import type { RpcResult } from '../contract.js';
import type { FuturesService } from './futures-service.js';
export type FuturesRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
export declare function createFuturesRpcHandler(service: FuturesService): FuturesRpcHandler;
//# sourceMappingURL=futures-rpc.d.ts.map