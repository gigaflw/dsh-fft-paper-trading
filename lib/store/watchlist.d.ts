/** UI preference, deliberately not part of the account ledger. */
export declare class WatchlistStore {
    private readonly file;
    constructor(home: string);
    read(): Promise<string[]>;
    write(symbols: string[]): Promise<string[]>;
}
//# sourceMappingURL=watchlist.d.ts.map