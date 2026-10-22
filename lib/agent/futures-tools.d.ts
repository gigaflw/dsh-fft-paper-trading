/**
 * The eight `futures_*` tools (D10).
 *
 * Same shape as `paper_*` — a one-paragraph Chinese summary plus the structured
 * view — but the vocabulary is futures (手, 开/平, 多/空) so the model never
 * confuses lots with shares. All of them go through {@link FuturesService}.
 *
 * @module @ft/dsh-fft-paper-trading/agent/futures-tools
 */
import type { FuturesAccountView, FuturesOrderView, FuturesPositionView, FuturesPreviewView, FuturesReviewView } from '../futures-contract.js';
import type { FuturesService } from '../service/futures-service.js';
import type { ToolsLike } from './tools.js';
declare function renderAccount(account: FuturesAccountView): string;
declare function renderOrder(order: FuturesOrderView): string;
declare function renderPositions(positions: FuturesPositionView[]): string;
declare function renderPreview(preview: FuturesPreviewView): string;
declare function renderReview(review: FuturesReviewView): string;
/** Register the eight `futures_*` tools. */
export declare function registerFuturesTools(tools: ToolsLike, service: FuturesService): void;
export { renderAccount, renderPositions, renderPreview, renderReview, renderOrder };
//# sourceMappingURL=futures-tools.d.ts.map