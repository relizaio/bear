// Unit tests for BomMetaService. No network, no database, and no AI API
// keys: outbound HTTP is a mocked global fetch and pgUtils is mocked, so
// the suite runs anywhere `npm test` does. AI parsing paths are exercised
// against canned OpenAI-shaped responses.
import { BomMetaService } from './bommeta.service'
import { SourceType } from '../model/Bommeta'

jest.mock('../utils/pgUtils', () => ({
    schema: 'bear',
    runQuery: jest.fn().mockResolvedValue({ rows: [] })
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runQuery } = require('../utils/pgUtils')

describe('BomMetaService', () => {
    let service: any
    const realFetch = global.fetch

    beforeEach(() => {
        service = new BomMetaService()
        ;(runQuery as jest.Mock).mockClear()
        ;(runQuery as jest.Mock).mockResolvedValue({ rows: [] })
    })

    afterEach(() => {
        global.fetch = realFetch
        jest.restoreAllMocks()
    })

    // Routes fetch by URL substring; unmatched URLs fail the test loudly.
    const routeFetch = (routes: Array<{ match: string, status?: number, json?: any, text?: string }>) => {
        const calls: string[] = []
        global.fetch = jest.fn().mockImplementation(async (url: string) => {
            calls.push(url)
            const route = routes.find(r => url.includes(r.match))
            if (!route) throw new Error(`Unexpected fetch in test: ${url}`)
            const status = route.status ?? 200
            return {
                ok: status >= 200 && status < 300,
                status,
                json: async () => route.json ?? {},
                text: async () => route.text ?? '',
                arrayBuffer: async () => new ArrayBuffer(0)
            }
        }) as any
        return calls
    }

    describe('parseLicenseResponse', () => {
        it('returns an id for a single SPDX identifier', () => {
            expect(service.parseLicenseResponse('MIT')).toEqual({ id: 'MIT' })
        })
        it('returns an expression when AND/OR operators are present', () => {
            expect(service.parseLicenseResponse('MIT AND Apache-2.0')).toEqual({ expression: 'MIT AND Apache-2.0' })
            expect(service.parseLicenseResponse('MIT OR GPL-2.0-only')).toEqual({ expression: 'MIT OR GPL-2.0-only' })
        })
    })

    describe('isInvalidLicense / isInvalidValue', () => {
        it.each(['NOASSERTION', 'OTHER', 'NONE', 'non-standard'])('rejects %s', (v) => {
            expect(service.isInvalidLicense({ id: v })).toBe(true)
        })
        it('rejects LicenseRef and empty', () => {
            expect(service.isInvalidLicense({ id: 'LicenseRef-scancode-unknown' })).toBe(true)
            expect(service.isInvalidLicense({})).toBe(true)
        })
        it('accepts a real SPDX id and expression', () => {
            expect(service.isInvalidLicense({ id: 'MIT' })).toBe(false)
            expect(service.isInvalidLicense({ expression: 'MIT AND ISC' })).toBe(false)
        })
    })

    describe('parseAiJson (confidence gate, no API key involved)', () => {
        it('accepts JSON at or above the threshold and strips confidence', () => {
            expect(service.parseAiJson('{"license": "MIT", "confidence": 0.9}')).toEqual({ license: 'MIT' })
        })
        it('rejects below-threshold confidence', () => {
            expect(service.parseAiJson('{"license": "MIT", "confidence": 0.3}')).toBeNull()
        })
        it('rejects missing or non-numeric confidence', () => {
            expect(service.parseAiJson('{"license": "MIT"}')).toBeNull()
            expect(service.parseAiJson('{"license": "MIT", "confidence": "high"}')).toBeNull()
        })
        it('unwraps markdown code fences', () => {
            expect(service.parseAiJson('```json\n{"name": "Acme", "confidence": 1}\n```')).toEqual({ name: 'Acme' })
        })
        it('rejects prose refusals and curly-quote explanations', () => {
            expect(service.parseAiJson('I cannot determine the supplier for this package')).toBeNull()
            expect(service.parseAiJson('It’s likely MIT')).toBeNull()
        })
        it('rejects unparseable output', () => {
            expect(service.parseAiJson('not json at all')).toBeNull()
        })
    })

    describe('extractGitHubRepoFromRepoUrl', () => {
        it.each([
            ['git+https://github.com/foo/bar.git', 'foo/bar'],
            ['https://github.com/foo/bar', 'foo/bar'],
            ['https://github.com/foo/bar#readme', 'foo/bar'],
            ['git://github.com/foo/bar.git', 'foo/bar']
        ])('extracts owner/repo from %s', (url, expected) => {
            expect(service.extractGitHubRepoFromRepoUrl(url)).toBe(expected)
        })
        it('returns null for non-GitHub or empty urls', () => {
            expect(service.extractGitHubRepoFromRepoUrl('https://gitlab.com/foo/bar')).toBeNull()
            expect(service.extractGitHubRepoFromRepoUrl('')).toBeNull()
        })
    })

    describe('URL builders', () => {
        it('builds deps.dev URLs with ecosystem-specific package naming', () => {
            expect(service.buildDepsDotDevUrl('pkg:npm/%40angular/core@17.0.0'))
                .toBe('https://api.deps.dev/v3/systems/NPM/packages/%40angular%2Fcore/versions/17.0.0')
            expect(service.buildDepsDotDevUrl('pkg:maven/org.apache/commons@1.2'))
                .toBe('https://api.deps.dev/v3/systems/MAVEN/packages/org.apache%3Acommons/versions/1.2')
            expect(service.buildDepsDotDevUrl('pkg:golang/github.com/foo/bar@v1.0.0'))
                .toBe('https://api.deps.dev/v3/systems/GO/packages/github.com%2Ffoo%2Fbar/versions/v1.0.0')
        })
        it('builds ClearlyDefined URLs against the public API with provider mapping', () => {
            expect(service.buildClearlyDefinedUrl('pkg:cargo/serde@1.0.0'))
                .toBe('https://api.clearlydefined.io/definitions/crate/cratesio/-/serde/1.0.0?expand=-files')
            // ClearlyDefined coordinates carry the literal decoded @scope
            expect(service.buildClearlyDefinedUrl('pkg:npm/%40scope/pkg@2.0.0'))
                .toBe('https://api.clearlydefined.io/definitions/npm/npmjs/@scope/pkg/2.0.0?expand=-files')
        })
        it('maps unknown purl types through unchanged', () => {
            expect(service.mapPurlTypeToClearlyDefined('deb')).toEqual({ type: 'deb', provider: 'deb' })
        })
    })

    describe('ecosystem support gates', () => {
        it('ClearlyDefined: apk unsupported, npm supported', () => {
            expect(service.isClearlyDefinedSupported('apk')).toBe(false)
            expect(service.isClearlyDefinedSupported('npm')).toBe(true)
        })
        it('deps.dev: composer unsupported, golang supported', () => {
            expect(service.isDepsDotDevSupported('composer')).toBe(false)
            expect(service.isDepsDotDevSupported('golang')).toBe(true)
        })
    })

    describe('supplier normalization', () => {
        it('normalizes known suppliers from the purl', () => {
            const n = service.getNormalization('pkg:nuget/Microsoft.Extensions.Logging@8.0.0')
            expect(n.name).toBe('Microsoft')
            expect(n.url).toBe('https://www.microsoft.com')
        })
        it('returns null for unknown suppliers', () => {
            expect(service.getNormalization('pkg:npm/leftpad@1.0.0')).toBeNull()
        })
        it('normalizes a resolved supplier by name', () => {
            const input = { name: 'microsoft corp', url: new Set<string>() }
            expect(service.normalizeSupplier(input).name).toBe('Microsoft')
        })
    })

    describe('buildComponent', () => {
        it('emits license id objects and expression objects distinctly', () => {
            const byId = service.buildComponent('pkg:npm/a@1', null, { id: 'MIT' }, null)
            expect(byId.licenses).toEqual([{ license: { id: 'MIT', name: undefined, url: undefined } }])
            const byExpr = service.buildComponent('pkg:npm/a@1', null, { expression: 'MIT AND ISC' }, 'Copyright (c) 2020 A')
            expect(byExpr.licenses).toEqual([{ expression: 'MIT AND ISC' }])
            expect(byExpr.copyright).toBe('Copyright (c) 2020 A')
            expect(byId.copyright).toBeNull()
        })
    })

    describe('enrichByPurl flows (mocked fetch + db, no AI keys)', () => {
        it('returns the cached cdx component without any network call', async () => {
            ;(runQuery as jest.Mock).mockResolvedValueOnce({ rows: [{
                uuid: 'u1', purl: 'pkg:npm/cached@1.0.0', ecosystem: 'npm',
                cdx_component: { type: 'library', purl: 'pkg:npm/cached@1.0.0' },
                sources: {}, cdx_schema_version: '1.7'
            }] })
            const calls = routeFetch([])
            const result = await service.enrichByPurl('pkg:npm/cached@1.0.0')
            expect(result).toEqual({ type: 'library', purl: 'pkg:npm/cached@1.0.0' })
            expect(calls).toHaveLength(0)
        })

        it('marks an npm package PRIVATE on registry 404 without persisting', async () => {
            const calls = routeFetch([
                { match: 'registry.npmjs.org', status: 404 }
            ])
            const result = await service.enrichByPurl('pkg:npm/%40corp/internal-pkg@1.0.0')
            expect(result.properties).toEqual([
                { name: 'reliza:componentMetadata:componentDistribution', value: 'PRIVATE' }
            ])
            expect(calls).toHaveLength(1)
            // Only the initial SELECT ran; the private marker is not saved
            expect((runQuery as jest.Mock).mock.calls).toHaveLength(1)
        })

        it('resolves supplier+license from npm and copyright from ClearlyDefined, never touching AI', async () => {
            const calls = routeFetch([
                { match: 'registry.npmjs.org', json: {
                    author: { name: 'Acme Corp', url: 'https://acme.example' },
                    license: 'MIT',
                    repository: { url: 'git+https://github.com/acme/pkg.git' }
                } },
                { match: 'api.clearlydefined.io', json: {
                    licensed: { facets: { core: { attribution: { parties: ['Copyright (c) 2021 Acme Corp'] } } } }
                } }
            ])
            const result = await service.enrichByPurl('pkg:npm/acme-pkg@1.0.0')

            expect(result.supplier).toEqual({ name: 'Acme Corp', url: ['https://acme.example'] })
            expect(result.licenses).toEqual([{ license: { id: 'MIT', name: undefined, url: undefined } }])
            expect(result.copyright).toBe('Copyright (c) 2021 Acme Corp')

            // No AI endpoints were ever contacted
            expect(calls.some(u => u.includes('openai') || u.includes('googleapis'))).toBe(false)

            // Persisted with per-field source attribution
            const insert = (runQuery as jest.Mock).mock.calls.find(c => c[0].includes('INSERT'))
            expect(insert).toBeDefined()
            const sources = JSON.parse(insert[1][4])
            expect(sources).toEqual({
                supplier: SourceType.NPM,
                license: SourceType.NPM,
                copyright: SourceType.CLEARLYDEFINED
            })
        })

        it('falls back through deps.dev and the GitHub LICENSE file for copyright', async () => {
            const calls = routeFetch([
                { match: 'api.deps.dev', json: {
                    licenses: ['MIT'],
                    links: [{ label: 'SOURCE_REPO', url: 'https://github.com/serde-rs/serde' }]
                } },
                { match: 'api.clearlydefined.io', json: {} },
                { match: 'raw.githubusercontent.com/serde-rs/serde/refs/heads/main/LICENSE',
                  text: 'MIT License\n\nCopyright (c) 2015 Serde Developers\n\nPermission is hereby granted...' },
                // Supplier has no non-AI source left, so the service attempts AI;
                // with no key configured the call fails and must fail CLOSED
                { match: 'api.openai.com', status: 401 }
            ])
            const result = await service.enrichByPurl('pkg:cargo/serde@1.0.0')

            expect(result.licenses).toEqual([{ license: { id: 'MIT', name: undefined, url: undefined } }])
            expect(result.copyright).toBe('Copyright (c) 2015 Serde Developers')
            expect(result.supplier).toBeNull()
        })
    })

    describe('deterministic registry flows (no AI possible)', () => {
        it('nuget: supplier, license, and copyright from one catalog chain', async () => {
            const calls = routeFetch([
                { match: 'registration5-gz-semver2', json: { catalogEntry: 'https://api.nuget.org/v3/catalog0/data/x.json' } },
                { match: 'catalog0', json: { authors: 'Contoso', licenseExpression: 'MIT', copyright: '© Contoso 2020' } },
                { match: 'api.clearlydefined.io', json: {} }
            ])
            const result = await service.enrichByPurl('pkg:nuget/Contoso.Lib@1.0.0')
            expect(result.supplier.name).toBe('Contoso')
            expect(result.licenses).toEqual([{ license: { id: 'MIT', name: undefined, url: undefined } }])
            expect(result.copyright).toBe('© Contoso 2020')
            expect(calls.some(u => u.includes('openai') || u.includes('googleapis'))).toBe(false)
            const insert = (runQuery as jest.Mock).mock.calls.find(c => c[0].includes('INSERT'))
            expect(JSON.parse(insert[1][4])).toEqual({
                supplier: SourceType.NUGET, license: SourceType.NUGET, copyright: SourceType.NUGET
            })
        })

        it('maven: supplier from the groupId normalization table without any supplier lookup', async () => {
            routeFetch([
                { match: 'repo1.maven.org', text: '<project><licenses><license><name>The Apache Software License, Version 2.0</name></license></licenses></project>' },
                { match: 'api.deps.dev', json: {} },
                { match: 'api.clearlydefined.io', json: {} }
            ])
            const result = await service.enrichByPurl('pkg:maven/org.apache.logging.log4j/log4j-core@2.24.3')
            expect(result.supplier.name).toBe('Apache Software Foundation')
            expect(result.licenses).toEqual([{ license: { id: 'Apache-2.0', name: undefined, url: undefined } }])
        })

        it('ClearlyDefined multi-candidate copyrights are selected by heuristic, not AI', async () => {
            routeFetch([
                { match: 'registry.npmjs.org', json: { author: { name: 'Acme' }, license: 'MIT',
                    repository: { url: 'https://github.com/acme/pkg' } } },
                { match: 'api.clearlydefined.io', json: { licensed: { facets: { core: { attribution: {
                    parties: ['Copyright (c) 2019 Acme', 'All rights reserved.', 'Copyright (c) 2021 Contributors'] } } } } } }
            ])
            const result = await service.enrichByPurl('pkg:npm/acme-multi@1.0.0')
            expect(result.copyright).toBe('Copyright (c) 2019 Acme\nCopyright (c) 2021 Contributors')
        })
    })

    describe('normalization-table and guard flows', () => {
        it('ssl_client generic resolves supplier AND license from the table, zero AI', async () => {
            const calls = routeFetch([])   // no network should be needed for supplier/license
            const result = await service.enrichByPurl('pkg:generic/ssl_client')
            expect(result.supplier.name).toBe('BusyBox')
            expect(result.licenses).toEqual([{ license: { id: 'GPL-2.0-only', name: undefined, url: undefined } }])
            expect(calls.some(u => u.includes('openai') || u.includes('googleapis'))).toBe(false)
            const insert = (runQuery as jest.Mock).mock.calls.find(c => c[0].includes('INSERT'))
            const sources = JSON.parse(insert[1][4])
            expect(sources.supplier).toBe(SourceType.AUTO)
            expect(sources.license).toBe(SourceType.AUTO)
        })

        it('email-shaped npm author is rejected as supplier', async () => {
            routeFetch([
                { match: 'registry.npmjs.org', json: { author: { name: 'packages@apollographql.com' }, license: 'MIT',
                    repository: { url: 'https://github.com/apollographql/apollo-client' } } },
                { match: 'api.clearlydefined.io', json: {} },
                { match: 'api.openai.com', status: 401 }
            ])
            const result = await service.enrichByPurl('pkg:npm/some-apollo-helper@1.0.0')
            // npm author skipped; CD empty; AI fails closed -> null, never the email
            expect(result.supplier).toBeNull()
        })

        it('@apollo/ scope resolves from the table before the npm author is even consulted', async () => {
            routeFetch([
                { match: 'registry.npmjs.org', json: { author: { name: 'packages@apollographql.com' }, license: 'MIT' } },
                { match: 'api.clearlydefined.io', json: {} }
            ])
            const result = await service.enrichByPurl('pkg:npm/%40apollo/client@4.2.12')
            expect(result.supplier.name).toBe('Apollo GraphQL, Inc.')
        })

        it('apk resolves license and maintainer from the Alpine index', async () => {
            const zlibMod = require('node:zlib')
            const idx = 'C:Q1x=\nP:pcre2\nV:10.47-r1\nL:BSD-3-Clause\nm:Jane Alpine <j@a.org>\nU:https://pcre2.example\n'
            const header = Buffer.alloc(512)
            header.write('APKINDEX', 0)
            header.write(Buffer.byteLength(idx).toString(8).padStart(11, '0') + '\0', 124)
            let sum = 0; header.write('        ', 148)
            for (const b of header) sum += b
            header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
            const content = Buffer.alloc(Math.ceil(Buffer.byteLength(idx) / 512) * 512)
            content.write(idx)
            const gz = zlibMod.gzipSync(Buffer.concat([header, content, Buffer.alloc(1024)]))
            routeFetch([
                { match: 'dl-cdn.alpinelinux.org', json: null, text: null } as any,
                { match: 'api.openai.com', status: 401 }
            ])
            // override: alpine fetch needs arrayBuffer of the gz
            const inner = global.fetch as jest.Mock
            const prev = inner.getMockImplementation()
            inner.mockImplementation(async (url: string, init: any) => {
                if (url.includes('dl-cdn.alpinelinux.org')) {
                    return { ok: true, status: 200, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) }
                }
                return prev(url, init)
            })
            const result = await service.enrichByPurl('pkg:apk/alpine/pcre2@10.47-r1?arch=x86_64&distro=alpine-3.24.1')
            expect(result.licenses).toEqual([{ license: { id: 'BSD-3-Clause', name: undefined, url: undefined } }])
            expect(result.supplier.name).toBe('Jane Alpine')
            const insert = (runQuery as jest.Mock).mock.calls.find(c => c[0].includes('INSERT'))
            const sources = JSON.parse(insert[1][4])
            expect(sources.license).toBe(SourceType.ALPINE)
        })
    })

    describe('AI response handling against canned payloads (no key, no network)', () => {
        it('parses a supplier out of an OpenAI-shaped response', async () => {
            routeFetch([
                { match: 'api.openai.com', json: {
                    output: [
                        { type: 'reasoning' },
                        { type: 'message', content: [{ text: '{"name": "Acme Corp", "url": ["https://acme.example"], "confidence": 0.95}' }] }
                    ]
                } }
            ])
            const supplier = await service.resolveSupplier('pkg:npm/acme-pkg@1.0.0')
            expect(supplier.name).toBe('Acme Corp')
            expect(Array.from(supplier.url)).toEqual(['https://acme.example'])
        })

        it('returns null when the AI is not confident', async () => {
            routeFetch([
                { match: 'api.openai.com', json: {
                    output: [{ type: 'message', content: [{ text: '{"license": "MIT", "confidence": 0.2}' }] }]
                } }
            ])
            await expect(service.resolveLicense('pkg:npm/obscure@0.0.1')).resolves.toBeNull()
        })

        it('returns null when the AI endpoint errors', async () => {
            routeFetch([{ match: 'api.openai.com', status: 500 }])
            await expect(service.resolveSupplier('pkg:npm/x@1.0.0')).resolves.toBeNull()
        })

        it('the AI copyright paths are gone entirely', () => {
            expect((service as any).resolveCopyright).toBeUndefined()
            expect((service as any).selectCopyright).toBeUndefined()
        })
    })
})
