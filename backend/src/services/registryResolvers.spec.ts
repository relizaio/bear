// Mocked-fetch tests for the deterministic registry resolvers. GitHub
// functions read BEAR_GITHUB_TOKEN at module load, so token-present and
// token-absent variants are loaded via jest.isolateModules.
import { PackageURL } from 'packageurl-js'

describe('registryResolvers', () => {
    const realFetch = global.fetch
    const realToken = process.env.BEAR_GITHUB_TOKEN

    afterEach(() => {
        global.fetch = realFetch
        if (realToken === undefined) delete process.env.BEAR_GITHUB_TOKEN
        else process.env.BEAR_GITHUB_TOKEN = realToken
        jest.resetModules()
    })

    const routeFetch = (routes: Array<{ match: string, status?: number, json?: any, text?: string }>) => {
        const calls: Array<{ url: string, init: any }> = []
        global.fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
            calls.push({ url, init })
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

    const load = (withToken: boolean) => {
        let mod: any
        jest.isolateModules(() => {
            if (withToken) process.env.BEAR_GITHUB_TOKEN = 'test-token'
            else delete process.env.BEAR_GITHUB_TOKEN
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            mod = require('./registryResolvers')
        })
        return mod
    }

    it('pypi: author + classifier-derived license, free-text license ignored when ambiguous', async () => {
        const mod = load(false)
        routeFetch([{ match: 'pypi.org', json: { info: {
            author: 'Ada Lovelace', home_page: 'https://ada.example',
            license: 'BSD style license',
            classifiers: ['License :: OSI Approved :: MIT License']
        } } }])
        const r = await mod.resolveOnPypi(PackageURL.fromString('pkg:pypi/mypkg@1.0.0'))
        expect(r).toEqual({ supplierName: 'Ada Lovelace', supplierUrl: 'https://ada.example', license: 'MIT' })
    })

    it('crates.io: license from version, owner as supplier, identifying User-Agent sent', async () => {
        const mod = load(false)
        const calls = routeFetch([
            { match: '/crates/serde/1.0.0', json: { version: { license: 'MIT OR Apache-2.0' } } },
            { match: '/owner_user', json: { users: [{ login: 'dtolnay', name: 'David Tolnay', url: 'https://github.com/dtolnay' }] } }
        ])
        const r = await mod.resolveOnCratesIo(PackageURL.fromString('pkg:cargo/serde@1.0.0'))
        expect(r.license).toBe('MIT OR Apache-2.0')
        expect(r.supplierName).toBe('David Tolnay')
        expect(calls[0].init.headers['User-Agent']).toContain('bear-enrichment')
    })

    it('rubygems: authors + first license', async () => {
        const mod = load(false)
        routeFetch([{ match: 'rubygems.org', json: { authors: 'DHH', homepage_uri: 'https://rubyonrails.org', licenses: ['MIT'] } }])
        const r = await mod.resolveOnRubyGems(PackageURL.fromString('pkg:gem/rails@7.0.0'))
        expect(r).toEqual({ supplierName: 'DHH', supplierUrl: 'https://rubyonrails.org', license: 'MIT' })
    })

    it('maven: organization and license parsed out of the POM', async () => {
        const mod = load(false)
        routeFetch([{ match: 'repo1.maven.org', text: `
<project>
  <organization><name>Apache Software Foundation</name><url>https://apache.org</url></organization>
  <licenses><license><name>The Apache Software License, Version 2.0</name></license></licenses>
</project>` }])
        const r = await mod.resolveOnMavenCentral(PackageURL.fromString('pkg:maven/org.apache.commons/commons-lang3@3.14.0'))
        expect(r).toEqual({ supplierName: 'Apache Software Foundation', supplierUrl: 'https://apache.org', license: 'Apache-2.0' })
    })

    it('nuget: one chain yields authors, licenseExpression, and copyright', async () => {
        const mod = load(false)
        routeFetch([
            { match: 'registration5-gz-semver2', json: { catalogEntry: 'https://api.nuget.org/v3/catalog0/data/x.json' } },
            { match: 'catalog0', json: { authors: 'Newtonsoft', licenseExpression: 'MIT', copyright: 'Copyright © James Newton-King 2008' } }
        ])
        const r = await mod.resolveOnNuget(PackageURL.fromString('pkg:nuget/Newtonsoft.Json@13.0.3'))
        expect(r).toEqual({ supplierName: 'Newtonsoft', license: 'MIT', copyright: 'Copyright © James Newton-King 2008' })
    })

    describe('github (token-gated)', () => {
        it('without a token every github function is a no-op with zero fetches', async () => {
            const mod = load(false)
            const calls = routeFetch([])
            expect(await mod.resolveGithubOwner('acme')).toEqual({})
            expect(await mod.resolveGithubLicense('acme/pkg')).toEqual({})
            expect(await mod.fetchGithubNotice('acme/pkg')).toBeNull()
            expect(calls).toHaveLength(0)
            expect(mod.hasGithubToken()).toBe(false)
        })

        it('owner: org profile with auth header; falls back to users on 404', async () => {
            const mod = load(true)
            const calls = routeFetch([
                { match: '/orgs/acme', status: 404 },
                { match: '/users/acme', json: { login: 'acme', name: 'Acme Corp', blog: 'https://acme.example' } }
            ])
            const r = await mod.resolveGithubOwner('acme')
            expect(r).toEqual({ supplierName: 'Acme Corp', supplierUrl: 'https://acme.example' })
            expect(calls[0].init.headers.Authorization).toBe('Bearer test-token')
        })

        it('license: spdx id plus base64-decoded content; NOASSERTION filtered', async () => {
            const mod = load(true)
            routeFetch([{ match: '/repos/acme/pkg/license', json: {
                license: { spdx_id: 'MIT' },
                encoding: 'base64',
                content: Buffer.from('MIT License\nCopyright (c) 2022 Acme Corp\n').toString('base64')
            } }])
            const r = await mod.resolveGithubLicense('acme/pkg')
            expect(r.spdxId).toBe('MIT')
            expect(r.content).toContain('Copyright (c) 2022 Acme Corp')

            routeFetch([{ match: '/license', json: { license: { spdx_id: 'NOASSERTION' } } }])
            expect((await mod.resolveGithubLicense('acme/other')).spdxId).toBeUndefined()
        })

        it('notice: tries conventional names until one exists', async () => {
            const mod = load(true)
            routeFetch([
                { match: '/contents/NOTICE.txt', json: { encoding: 'base64', content: Buffer.from('Copyright 2019-2024 The Acme Authors').toString('base64') } },
                { match: '/contents/NOTICE', status: 404 }
            ])
            const notice = await mod.fetchGithubNotice('acme/pkg')
            expect(notice).toBe('Copyright 2019-2024 The Acme Authors')
        })
    })
})
