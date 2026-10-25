/**
 * Data-source state for the panel header.
 *
 * The panel must be able to say which of four worlds it is in — key configured,
 * anonymous free tier, no FTShare service at all, or a key that cannot be used
 * — without reading the key itself. This module only calls the settings
 * service's `describe()` (configured flag, source, last validation); it never
 * resolves the secret, never writes settings and never goes upstream.
 * @module @dsh-ft/dsh-fft-paper-trading/service/data-source
 */
import type { DataProblem, DataSourceStatus } from '../contract.js';
/** Structural slice of `ctx.ftshareSettings.apiKey`; no runtime import across packages. */
export interface FtshareApiKeyLike {
    describe?(): Promise<unknown>;
}
/** Structural slice of the shared FTShare settings service. */
export interface FtshareSettingsLike {
    apiKey?: FtshareApiKeyLike;
}
export interface DataSourceProbeInput {
    /** Whether `ctx.ftshareData` is attached (i.e. the FTShare plugin is installed). */
    dataService: boolean;
    settings?: FtshareSettingsLike;
}
/**
 * Probe the data source without touching the credential value.
 * @param input - whether the data service is attached plus the settings handle.
 * @returns the four-state status for the panel header.
 */
export declare function probeDataSource(input: DataSourceProbeInput): Promise<DataSourceStatus>;
/** Map one failed market-data result to the reason the banner acts on. */
export declare function classifyDataProblem(input: {
    state: string;
    notice?: string;
    noticeCode?: string;
}, at: string): DataProblem | undefined;
//# sourceMappingURL=data-source.d.ts.map