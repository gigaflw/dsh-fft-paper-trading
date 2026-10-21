import { PAPER_MAX_BODY_BYTES, PAPER_ROUTE, type RpcResult } from '../contract.js'
import type { PaperRpcHandler } from './rpc.js'

export interface PaperRoute {
  readonly path: typeof PAPER_ROUTE
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

export interface HostFetchLike {
  register(route: PaperRoute): () => Promise<void>
}

export interface HostConnectionLike {
  fetch: HostFetchLike
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function failure(code: string, message: string): RpcResult<unknown> {
  return { ok: false, error: { code, message } }
}

/** Exact Fetch route behind `/api`, mirroring the settings-plugin pattern. */
export function createPaperRoute(handler: PaperRpcHandler): PaperRoute {
  return {
    path: PAPER_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return json(405, failure('INVALID_ARGUMENT', '只支持 POST'))
      const length = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(length) && length > PAPER_MAX_BODY_BYTES) {
        return json(413, failure('INVALID_ARGUMENT', '请求体过大'))
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json(400, failure('INVALID_ARGUMENT', '请求体不是合法 JSON'))
      }
      if (typeof body !== 'object' || body === null) {
        return json(400, failure('INVALID_ARGUMENT', '请求体必须是对象'))
      }
      const { endpoint, payload } = body as { endpoint?: unknown; payload?: unknown }
      if (typeof endpoint !== 'string' || endpoint === '') {
        return json(400, failure('INVALID_ARGUMENT', '缺少 endpoint'))
      }
      const controller = new AbortController()
      const abort = () => controller.abort()
      request.signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await handler(endpoint, payload, controller.signal)
        return json(200, result)
      } finally {
        request.signal.removeEventListener('abort', abort)
      }
    },
  }
}
