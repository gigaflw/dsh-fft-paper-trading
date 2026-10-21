import type { OrderType, SessionPhase } from '../contract.js';
/** A-share session table, Asia/Shanghai. Auctions are separate phases. */
export interface SessionWindow {
    phase: SessionPhase;
    /** Minutes since midnight. */
    start: number;
    end: number;
    canSubmitMarket: boolean;
    canSubmitLimit: boolean;
    canMatch: boolean;
}
export declare const SESSION_WINDOWS: readonly SessionWindow[];
/** Shanghai date plus minutes since midnight for an ISO timestamp. */
export declare function shanghaiClock(iso: string): {
    date: string;
    minutes: number;
};
export declare function windowOf(phase: SessionPhase): SessionWindow;
export declare function sessionPhaseAt(iso: string): SessionPhase;
export declare function canMatch(phase: SessionPhase): boolean;
export declare function canSubmit(phase: SessionPhase, type: OrderType): boolean;
/** ISO timestamp for a Shanghai wall-clock minute on a `YYYY-MM-DD` date. */
export declare function isoAtShanghai(date: string, minutes: number): string;
/** Next session boundary after `iso`; may be a non-trading day, which the caller resolves. */
export declare function nextBoundary(iso: string): {
    at: string;
    phase: SessionPhase;
};
//# sourceMappingURL=session.d.ts.map