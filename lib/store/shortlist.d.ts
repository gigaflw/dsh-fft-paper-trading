/** UI preference, deliberately not part of the account ledger. */
export declare class ShortlistStore {
    private readonly file;
    /** Pre-rename name of the same file; read once, then moved so the two cannot drift. */
    private readonly previous;
    constructor(home: string);
    read(): Promise<string[]>;
    write(symbols: string[]): Promise<string[]>;
}
//# sourceMappingURL=shortlist.d.ts.map