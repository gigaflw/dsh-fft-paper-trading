/**
 * Data-source state for the panel header.
 *
 * The panel must be able to say which of four worlds it is in — key configured,
 * anonymous free tier, no FTShare service at all, or a key that cannot be used
 * — without reading the key itself. This module only calls the settings
 * service's `describe()` (configured flag, source, last validation); it never
 * resolves the secret, never writes settings and never goes upstream.
 * @module @ft/dsh-fft-paper-trading/service/data-source
 */
/** Validation statuses that mean the configured key itself is unusable. */
const UNUSABLE_KEY_STATES = new Set(['auth_failed', 'auth_required']);
/** Validation statuses that say nothing useful; a configured key stays configured. */
const QUIET_STATES = new Set(['available', 'not_run']);
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : undefined;
}
function asText(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/** Read `validation.apiKey` from a settings `describe()` payload. */
function apiKeyProbe(described) {
    const validation = asRecord(described.validation);
    const probe = asRecord(validation?.apiKey);
    return { status: asText(probe?.status), message: asText(probe?.message) };
}
/**
 * Probe the data source without touching the credential value.
 * @param input - whether the data service is attached plus the settings handle.
 * @returns the four-state status for the panel header.
 */
export async function probeDataSource(input) {
    if (!input.dataService)
        return { state: 'none' };
    const describe = input.settings?.apiKey?.describe;
    if (typeof describe !== 'function') {
        return { state: 'invalid', message: '无法读取 FTShare Key 状态' };
    }
    let status;
    try {
        const described = asRecord(await describe());
        if (described === undefined) {
            status = { state: 'invalid', message: '无法读取 FTShare Key 状态' };
        }
        else if (described.configured !== true) {
            status = { state: 'free' };
        }
        else {
            const probe = apiKeyProbe(described);
            if (probe.status !== undefined && UNUSABLE_KEY_STATES.has(probe.status)) {
                status = { state: 'invalid', ...(probe.message === undefined ? {} : { message: probe.message }) };
            }
            else if (probe.status !== undefined && !QUIET_STATES.has(probe.status)) {
                // The key is configured, but its last check did not come back clean
                // (plan limit, quota, outage). Keep the state honest and explain it.
                status = { state: 'configured', ...(probe.message === undefined ? {} : { message: probe.message }) };
            }
            else {
                status = { state: 'configured' };
            }
        }
    }
    catch {
        status = { state: 'invalid', message: '无法读取 FTShare Key 状态' };
    }
    return status;
}
//# sourceMappingURL=data-source.js.map