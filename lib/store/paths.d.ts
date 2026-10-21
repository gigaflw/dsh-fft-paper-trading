/** Resolve `$DSH_HOME` with the same semantics as the host: env, then `~/.dsh`. */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
export declare function paperRoot(home?: string): string;
export declare function accountDir(home: string, accountId: string): string;
export declare function eventsPath(home: string, accountId: string): string;
export declare function backupsDir(home: string, accountId: string): string;
//# sourceMappingURL=paths.d.ts.map