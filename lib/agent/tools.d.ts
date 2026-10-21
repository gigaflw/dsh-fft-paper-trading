import type { PaperService } from '../service/paper-service.js';
export interface ToolsLike {
    register(tool: unknown): unknown;
}
/** Register the eight `paper_*` tools. All of them go through PaperService. */
export declare function registerPaperTools(tools: ToolsLike, service: PaperService): void;
//# sourceMappingURL=tools.d.ts.map