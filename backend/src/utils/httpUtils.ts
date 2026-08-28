// Thin wrappers over the Node built-in fetch (undici), replacing axios.
// Every request carries a timeout: upstream metadata APIs default to 10s,
// AI calls pass a longer one explicitly. Non-2xx responses throw HttpError
// so callers can branch on status (e.g. npm registry 404 = private package).

export class HttpError extends Error {
    constructor(public readonly status: number, url: string) {
        super(`HTTP ${status} for ${url}`)
        this.name = 'HttpError'
    }
}

export interface HttpOptions {
    timeoutMs?: number
    headers?: Record<string, string>
}

const DEFAULT_TIMEOUT_MS = 10000

async function request (url: string, init: RequestInit, opts?: HttpOptions) : Promise<Response> {
    const resp = await fetch(url, {
        ...init,
        headers: opts?.headers,
        signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    })
    if (!resp.ok) {
        // Consume the body so the socket is released back to the pool
        await resp.arrayBuffer().catch(() => undefined)
        throw new HttpError(resp.status, url)
    }
    return resp
}

export async function getJson<T = any> (url: string, opts?: HttpOptions) : Promise<T> {
    const resp = await request(url, { method: 'GET' }, opts)
    return await resp.json() as T
}

export async function getBuffer (url: string, opts?: HttpOptions) : Promise<Buffer> {
    const resp = await request(url, { method: 'GET' }, opts)
    return Buffer.from(await resp.arrayBuffer())
}

export async function getText (url: string, opts?: HttpOptions) : Promise<string> {
    const resp = await request(url, { method: 'GET' }, opts)
    return await resp.text()
}

export async function postJson<T = any> (url: string, body: any, opts?: HttpOptions) : Promise<T> {
    const resp = await request(url, {
        method: 'POST',
        body: JSON.stringify(body)
    }, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opts?.headers }
    })
    return await resp.json() as T
}
