// Deterministic per-ecosystem metadata lookups that run before any AI
// fallback. Every function is network-only against a public registry, uses
// the shared fetch helpers (10s timeout), and fails soft: errors return an
// empty result and the enrichment chain simply moves on.
//
// GitHub calls are conditional on BEAR_GITHUB_TOKEN (a no-scope PAT is
// enough - it only buys the 5,000/hr authenticated rate limit; all data
// read is public). Without a token they are skipped rather than burning
// the 60/hr unauthenticated IP budget.
import { PackageURL } from 'packageurl-js'
import { getJson, getText } from '../utils/httpUtils'
import { licenseFromPypiClassifiers, normalizeLicenseString } from './copyrightHeuristics'

export interface RegistryResult {
    supplierName?: string
    supplierUrl?: string
    license?: string
    copyright?: string
}

export interface GithubLicenseResult {
    spdxId?: string
    content?: string
}

const GITHUB_TOKEN = process.env.BEAR_GITHUB_TOKEN

export function hasGithubToken () : boolean {
    return !!GITHUB_TOKEN
}

function githubHeaders () : Record<string, string> {
    return {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'bear-enrichment'
    }
}

export async function resolveOnPypi (purl: PackageURL) : Promise<RegistryResult> {
    try {
        const url = `https://pypi.org/pypi/${encodeURIComponent(purl.name)}/${encodeURIComponent(purl.version || '')}/json`
        console.log(`Calling PyPI API: ${url}`)
        const data = await getJson(url)
        const info = data?.info || {}
        const result: RegistryResult = {}
        if (info.author) result.supplierName = info.author
        else if (info.maintainer) result.supplierName = info.maintainer
        const homepage = info.project_urls?.Homepage || info.home_page
        if (homepage) result.supplierUrl = homepage
        // license field is free text on PyPI; classifiers are more reliable
        result.license = licenseFromPypiClassifiers(info.classifiers)
            || (info.license ? normalizeLicenseString(info.license) : null)
            || undefined
        return result
    } catch (error) {
        console.error('Error calling PyPI API:', (error as Error).message)
        return {}
    }
}

export async function resolveOnCratesIo (purl: PackageURL) : Promise<RegistryResult> {
    try {
        // crates.io policy requires an identifying User-Agent
        const headers = { 'User-Agent': 'bear-enrichment (https://github.com/relizaio/bear)' }
        const base = `https://crates.io/api/v1/crates/${encodeURIComponent(purl.name)}`
        const versionUrl = `${base}/${encodeURIComponent(purl.version || '')}`
        console.log(`Calling crates.io API: ${versionUrl}`)
        const data = await getJson(versionUrl, { headers })
        const result: RegistryResult = {}
        if (data?.version?.license) {
            result.license = normalizeLicenseString(data.version.license) || undefined
        }
        try {
            const owners = await getJson(`${base}/owner_user`, { headers })
            const first = owners?.users?.[0]
            if (first) {
                result.supplierName = first.name || first.login
                if (first.url) result.supplierUrl = first.url
            }
        } catch {
            // owners endpoint missing is not fatal
        }
        return result
    } catch (error) {
        console.error('Error calling crates.io API:', (error as Error).message)
        return {}
    }
}

export async function resolveOnRubyGems (purl: PackageURL) : Promise<RegistryResult> {
    try {
        const url = `https://rubygems.org/api/v2/rubygems/${encodeURIComponent(purl.name)}/versions/${encodeURIComponent(purl.version || '')}.json`
        console.log(`Calling RubyGems API: ${url}`)
        const data = await getJson(url)
        const result: RegistryResult = {}
        if (data?.authors) result.supplierName = data.authors
        if (data?.homepage_uri) result.supplierUrl = data.homepage_uri
        const license = data?.licenses?.[0]
        if (license) result.license = normalizeLicenseString(license) || undefined
        return result
    } catch (error) {
        console.error('Error calling RubyGems API:', (error as Error).message)
        return {}
    }
}

// Maven Central POM. Parsed with targeted regexes rather than an XML
// dependency: we only need three shallow, well-formed elements, and a parse
// miss just means the chain continues. Known limitation: values inherited
// from a parent POM are not resolved.
export async function resolveOnMavenCentral (purl: PackageURL) : Promise<RegistryResult> {
    try {
        if (!purl.namespace || !purl.version) return {}
        const groupPath = purl.namespace.replace(/\./g, '/')
        const url = `https://repo1.maven.org/maven2/${groupPath}/${purl.name}/${purl.version}/${purl.name}-${purl.version}.pom`
        console.log(`Fetching Maven POM: ${url}`)
        const pom = await getText(url)
        const result: RegistryResult = {}
        const org = firstTag(section(pom, 'organization'), 'name')
        if (org) {
            result.supplierName = org
            const orgUrl = firstTag(section(pom, 'organization'), 'url')
            if (orgUrl) result.supplierUrl = orgUrl
        }
        const licenseName = firstTag(section(pom, 'license'), 'name')
        if (licenseName) result.license = normalizeLicenseString(licenseName) || undefined
        return result
    } catch (error) {
        console.error('Error fetching Maven POM:', (error as Error).message)
        return {}
    }
}

function section (xml: string, tag: string) : string {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
    return m ? m[1] : ''
}

function firstTag (xml: string, tag: string) : string | null {
    const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))
    return m ? m[1] : null
}

// NuGet registration -> catalog entry: one chain yields authors, the
// license expression, and the package's declared copyright.
export async function resolveOnNuget (purl: PackageURL) : Promise<RegistryResult> {
    try {
        const packageName = purl.name.toLowerCase()
        const version = purl.version
        const registrationUrl = `https://api.nuget.org/v3/registration5-gz-semver2/${packageName}/${version}.json`
        console.log(`Calling NuGet API: ${registrationUrl}`)
        const registration = await getJson(registrationUrl)
        if (!registration?.catalogEntry) return {}
        const catalog = await getJson(registration.catalogEntry)
        const result: RegistryResult = {}
        if (catalog?.authors) result.supplierName = catalog.authors
        if (catalog?.licenseExpression) {
            result.license = normalizeLicenseString(catalog.licenseExpression) || undefined
        }
        if (catalog?.copyright) result.copyright = catalog.copyright
        return result
    } catch (error) {
        console.error('Error calling NuGet API:', (error as Error).message)
        return {}
    }
}

// GitHub org (fallback: user) profile - supplier candidate for any package
// whose source repo is known.
export async function resolveGithubOwner (owner: string) : Promise<RegistryResult> {
    if (!hasGithubToken()) return {}
    try {
        for (const kind of ['orgs', 'users']) {
            try {
                const url = `https://api.github.com/${kind}/${encodeURIComponent(owner)}`
                console.log(`Calling GitHub API: ${url}`)
                const data = await getJson(url, { headers: githubHeaders() })
                if (data?.name || data?.login) {
                    return {
                        supplierName: data.name || data.login,
                        supplierUrl: data.blog || data.html_url || undefined
                    }
                }
            } catch {
                // 404 on orgs -> try users
            }
        }
        return {}
    } catch (error) {
        console.error('Error calling GitHub owner API:', (error as Error).message)
        return {}
    }
}

// GitHub license detection: one call returns both the SPDX id (as detected
// by licensee, on the default branch, whatever the file is named) and the
// license file content for copyright extraction.
export async function resolveGithubLicense (repo: string) : Promise<GithubLicenseResult> {
    if (!hasGithubToken()) return {}
    try {
        const url = `https://api.github.com/repos/${repo}/license`
        console.log(`Calling GitHub license API: ${url}`)
        const data = await getJson(url, { headers: githubHeaders() })
        const result: GithubLicenseResult = {}
        const spdx = data?.license?.spdx_id
        if (spdx && spdx !== 'NOASSERTION') result.spdxId = spdx
        if (data?.content && data?.encoding === 'base64') {
            result.content = Buffer.from(data.content, 'base64').toString('utf-8')
        }
        return result
    } catch (error) {
        console.error('Error calling GitHub license API:', (error as Error).message)
        return {}
    }
}

// NOTICE file for Apache-2.0 repos, where the copyright notice lives by
// convention (the Apache LICENSE text itself has no project copyright).
export async function fetchGithubNotice (repo: string) : Promise<string | null> {
    if (!hasGithubToken()) return null
    for (const name of ['NOTICE', 'NOTICE.txt', 'NOTICE.md']) {
        try {
            const url = `https://api.github.com/repos/${repo}/contents/${name}`
            const data = await getJson(url, { headers: githubHeaders() })
            if (data?.content && data?.encoding === 'base64') {
                return Buffer.from(data.content, 'base64').toString('utf-8')
            }
        } catch {
            // try next conventional name
        }
    }
    return null
}
