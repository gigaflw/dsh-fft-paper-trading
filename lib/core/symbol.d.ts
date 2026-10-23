/**
 * Security identity.
 *
 * A six-digit code is only unique inside one exchange: `000001.SZ` is 平安银行,
 * `000001.SH` is 上证指数 and `000001.OF` is a fund. Everything that enters the
 * ledger, the market data adapter or the UI therefore uses one canonical id,
 * `<code>.<exchange>`. This module is the only place that knows the exchange
 * code ranges, so parsing, validation and display stay in agreement.
 *
 * Bare six-digit input is resolved through the *stock* namespace first
 * (`000001` → `000001.SZ`); an index or a fund always needs its suffix
 * (`000001.SH`, `510300.SH`). Only stocks are tradable.
 * @module @ft/dsh-fft-paper-trading/core/symbol
 */
export type Exchange = 'SH' | 'SZ' | 'BJ';
export type SymbolKind = 'stock' | 'index' | 'fund' | 'other';
export type Board = 'main' | 'star' | 'chi_next' | 'bjse';
/** A fully resolved security: the only accepted identity inside the plugin. */
export interface ListedSymbol {
    code: string;
    exchange: Exchange;
    kind: SymbolKind;
    /** `<code>.<exchange>`, e.g. `000001.SZ`. */
    id: string;
}
export type SymbolProblemCode = 'INVALID_SYMBOL' | 'UNSUPPORTED_INSTRUMENT';
export type SymbolResult = {
    ok: true;
    symbol: ListedSymbol;
} | {
    ok: false;
    code: SymbolProblemCode;
    message: string;
};
/**
 * Parse one user/model supplied symbol.
 *
 * Accepted forms: `000001`, `000001.SZ`, `000001.XSHE`, `SZ000001` (case and
 * full-width digits are folded). Everything else is rejected instead of guessed.
 */
export declare function tryParseSymbol(input: unknown): SymbolResult;
/** Parse and require a tradable A-share stock. */
export declare function requireStock(input: unknown): SymbolResult;
export declare function isTradable(symbol: ListedSymbol): boolean;
/** Board of a tradable stock; `main` for anything the ranges do not name. */
export declare function boardOf(symbol: ListedSymbol): Board;
/** `000001.SZ 平安银行`; the name is dropped when the data source has none. */
export declare function formatSymbol(id: string, name?: string): string;
//# sourceMappingURL=symbol.d.ts.map