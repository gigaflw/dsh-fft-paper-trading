/** Detach a value into plain JSON: absent optionals stay absent, NaN/Infinity become null. */
export declare function plainJson<T>(value: T): T;
/**
 * Loose tool-options shape. Deriving the schema generics here makes TypeScript
 * compare inferred object types recursively until it overflows, and the call
 * sites already declare their own argument schemas.
 */
interface LooseToolOptions {
    readonly name: string;
    readonly description: string;
    readonly execute: (args: any, exec: any) => Promise<any>;
    readonly [key: string]: unknown;
}
/** {@link defineTool} whose result body is safe at DSH's lossless-JSON boundary. */
export declare function defineJsonTool(options: LooseToolOptions): import("@deepseek-ai/dsh-tools").ToolDefinition;
export {};
//# sourceMappingURL=json-tools.d.ts.map