import { getJson, getText, postJson, HttpError } from './httpUtils'

describe('httpUtils', () => {
    const realFetch = global.fetch

    afterEach(() => {
        global.fetch = realFetch
        jest.restoreAllMocks()
    })

    const mockFetch = (resp: Partial<Response>) => {
        const fn = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
            ...resp
        })
        global.fetch = fn as any
        return fn
    }

    it('getJson returns the parsed body', async () => {
        mockFetch({ json: async () => ({ hello: 'world' }) })
        await expect(getJson('https://example.com/x')).resolves.toEqual({ hello: 'world' })
    })

    it('getJson throws HttpError carrying the status on non-2xx', async () => {
        mockFetch({ ok: false, status: 404 })
        const err = await getJson('https://example.com/missing').catch(e => e)
        expect(err).toBeInstanceOf(HttpError)
        expect(err.status).toBe(404)
        expect(err.message).toContain('https://example.com/missing')
    })

    it('getText returns the raw body', async () => {
        mockFetch({ text: async () => 'MIT License\nCopyright (c) 2020 Acme' })
        await expect(getText('https://example.com/LICENSE')).resolves.toContain('Copyright (c) 2020 Acme')
    })

    it('postJson serializes the body and sets JSON headers', async () => {
        const fn = mockFetch({ json: async () => ({ ok: 1 }) })
        await postJson('https://example.com/api', { q: 'x' }, { headers: { 'x-extra': 'y' } })
        const [url, init] = fn.mock.calls[0]
        expect(url).toBe('https://example.com/api')
        expect(init.method).toBe('POST')
        expect(init.body).toBe('{"q":"x"}')
        expect(init.headers['Content-Type']).toBe('application/json')
        expect(init.headers['x-extra']).toBe('y')
    })

    it('every request carries an abort signal (timeout)', async () => {
        const fn = mockFetch({})
        await getJson('https://example.com/x')
        const [, init] = fn.mock.calls[0]
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })
})
