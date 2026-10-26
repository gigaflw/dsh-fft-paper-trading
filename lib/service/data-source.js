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
/** API-key and authentication codes: the key itself is missing or rejected. */
const AUTH_CODES = new Set([
    '401', 'unauthorized', 'auth_required', 'invalid_key', 'invalid_api_key',
    'upstream_unauthenticated', 'api_key_header_missing', 'api_key_malformed',
]);
/** Plan/permission codes: the key works but the subscription does not cover it. */
const PLAN_CODES = new Set([
    '403', 'forbidden', 'route_not_allowed', 'capability_limited', 'permission_denied',
    'insufficient_permissions', 'subscription_required',
]);
/** Codes that mean "too many requests today" rather than an outage. */
const QUOTA_CODES = new Set(['insufficient_quota', 'quota_exceeded', 'quota_exhausted', '429', 'rate_limited']);
/** Codes that mean the network or the gateway is temporarily down. */
const NETWORK_CODES = new Set([
    'timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'fetch_failed',
    '502', '503', '504',
]);
/**
 * 额度用尽在提示文案里的信号。
 *
 * 上游把「匿名额度耗尽」和「真的停机」报成同一个码（`UPSTREAM_UNAVAILABLE`），
 * 额度这件事只写在文案里（「最近 1 天最多访问 500 次」），bundle 还会在提示后缀
 * `免费配额用尽…`。因此这里认「用尽 / 耗尽 / 最多访问」这类表述，**不认「额度」
 * 二字**：套餐提示里也常出现「额度」，照字面读会把套餐问题说成额度问题。
 */
const QUOTA_TEXT = /免费配额用尽|配额用尽|额度(?:已)?用尽|额度耗尽|最多访问/;
/** Longest upstream cause kept in a problem record. */
const MESSAGE_MAX_LENGTH = 160;
/** Adapter internals that must not reach the panel or the model verbatim. */
const INTERNAL_TEXT = /FTShare|UPSTREAM|invalid symbol|symbols\[|调用失败|参数格式|request/i;
function trimMessage(text) {
    const flat = (text ?? '').replace(/\s+/g, ' ').trim();
    if (flat === '')
        return '行情暂不可用';
    return flat.length <= MESSAGE_MAX_LENGTH ? flat : `${flat.slice(0, MESSAGE_MAX_LENGTH)}…`;
}
/** Map one failed market-data result to the reason the banner acts on. */
export function classifyDataProblem(input, at) {
    if (input.state === 'ok')
        return undefined;
    const code = input.noticeCode?.toLowerCase();
    const text = input.notice ?? '';
    let reason;
    if (code !== undefined && AUTH_CODES.has(code))
        reason = 'invalid-key';
    else if (code !== undefined && PLAN_CODES.has(code))
        reason = 'plan-denied';
    else if (code !== undefined && QUOTA_CODES.has(code))
        reason = 'quota';
    else if (QUOTA_TEXT.test(text))
        reason = 'quota';
    else if (code !== undefined && NETWORK_CODES.has(code))
        reason = 'network';
    // `denied` is the FTShare layer's permission verdict; without a specific
    // code it still means "the plan/credential does not cover this interface".
    else if (input.state === 'denied')
        reason = 'plan-denied';
    else
        reason = 'upstream';
    return { reason, message: trimMessage(input.notice), at };
}
/**
 * One user-facing sentence for a failed market-data result.
 *
 * Shared by the stock and futures services so both accounts explain the same
 * failure the same way. Known reasons get fixed copy; an unknown cause keeps a
 * short upstream notice when it holds no adapter internals, otherwise `fallback`.
 * @param input - the failed result's state, notice and upstream code.
 * @param fallback - what to say when the cause has no better wording.
 * @param at - ISO time used to stamp the classified problem.
 */
export function friendlyDataNotice(input, fallback, at) {
    const problem = classifyDataProblem(input, at);
    switch (problem?.reason) {
        case 'invalid-key': return '行情需要 API Key（「设置」中配置后重试）';
        // A keyless beginner must not read "套餐" as something they already own: name
        // both routes, since the free tier has no plan at all.
        case 'plan-denied': return '该行情接口需要配置 API Key 或开通套餐';
        // The same reason also covers a keyed account being throttled, so the remedy
        // names the allowance rising instead of assuming no key is configured.
        case 'quota': return '行情额度已用尽：配置 API Key 或等待额度恢复';
        case 'network': return '行情服务暂时不可用，请稍后重试';
        default: break;
    }
    if (input.notice === undefined || input.notice === '')
        return fallback;
    return INTERNAL_TEXT.test(input.notice) ? fallback : input.notice;
}
//# sourceMappingURL=data-source.js.map