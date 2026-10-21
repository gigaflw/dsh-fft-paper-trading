import { PAPER_MAX_BODY_BYTES, PAPER_ROUTE } from '../contract.js';
function json(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
function failure(code, message) {
    return { ok: false, error: { code, message } };
}
/** Exact Fetch route behind `/api`, mirroring the settings-plugin pattern. */
export function createPaperRoute(handler) {
    return {
        path: PAPER_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
            if (request.method !== 'POST')
                return json(405, failure('INVALID_ARGUMENT', '只支持 POST'));
            const length = Number(request.headers.get('content-length') ?? '0');
            if (Number.isFinite(length) && length > PAPER_MAX_BODY_BYTES) {
                return json(413, failure('INVALID_ARGUMENT', '请求体过大'));
            }
            let body;
            try {
                body = await request.json();
            }
            catch {
                return json(400, failure('INVALID_ARGUMENT', '请求体不是合法 JSON'));
            }
            if (typeof body !== 'object' || body === null) {
                return json(400, failure('INVALID_ARGUMENT', '请求体必须是对象'));
            }
            const { endpoint, payload } = body;
            if (typeof endpoint !== 'string' || endpoint === '') {
                return json(400, failure('INVALID_ARGUMENT', '缺少 endpoint'));
            }
            const controller = new AbortController();
            const abort = () => controller.abort();
            request.signal.addEventListener('abort', abort, { once: true });
            try {
                const result = await handler(endpoint, payload, controller.signal);
                return json(200, result);
            }
            finally {
                request.signal.removeEventListener('abort', abort);
            }
        },
    };
}
//# sourceMappingURL=route.js.map