import type { ErrorCode } from '../contract.js';
export declare class PaperError extends Error {
    readonly code: ErrorCode | 'INTERNAL';
    readonly status: number;
    constructor(code: ErrorCode | 'INTERNAL', message: string, status?: number);
}
//# sourceMappingURL=errors.d.ts.map