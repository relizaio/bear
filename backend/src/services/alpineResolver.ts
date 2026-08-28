// Deterministic apk resolution against Alpine's own package index.
// APKINDEX.tar.gz (per branch/repo/arch) carries, per package: V (version),
// L (license, SPDX), m (maintainer), U (upstream URL). One ~500KB download
// covers every package in a repo, so indexes are cached in memory per
// (branch, repo, arch) - an Alpine-image SBOM costs at most two fetches
// (main + community) rather than one per component.
import * as zlib from 'node:zlib'
import { PackageURL } from 'packageurl-js'
import { getBuffer } from '../utils/httpUtils'
import { normalizeLicenseString } from './copyrightHeuristics'

export interface AlpinePackageInfo {
    version?: string
    license?: string
    maintainerName?: string
    upstreamUrl?: string
}

const ALPINE_CDN = process.env.BEAR_ALPINE_CDN || 'https://dl-cdn.alpinelinux.org/alpine'
const REPOS = ['main', 'community']
const DEFAULT_ARCH = 'x86_64'

// (branch|repo|arch) -> package name -> info. Indexes are immutable per
// Alpine point release for our fields, so no TTL: process lifetime cache.
const indexCache = new Map<string, Map<string, AlpinePackageInfo>>()
// Failed fetches are cached too, so a missing branch does not retry per component
const failedKeys = new Set<string>()

// "alpine-3.24.1" / "alpine-3.24" (purl distro qualifier) -> "v3.24"
export function branchFromDistro (distro?: string) : string | null {
    if (!distro) return null
    const m = distro.match(/^alpine-(\d+)\.(\d+)/)
    return m ? `v${m[1]}.${m[2]}` : null
}

// Minimal ustar walk: 512-byte headers, name at 0-99, size as octal at
// 124-135, content padded to 512. Returns the named member's bytes.
export function extractTarMember (tar: Buffer, memberName: string) : Buffer | null {
    let offset = 0
    while (offset + 512 <= tar.length) {
        const name = tar.subarray(offset, offset + 100).toString('utf-8').replace(/\0.*$/, '')
        if (!name) break
        const size = parseInt(tar.subarray(offset + 124, offset + 136).toString('utf-8').replace(/\0.*$/, '').trim(), 8) || 0
        if (name === memberName) {
            return tar.subarray(offset + 512, offset + 512 + size)
        }
        offset += 512 + Math.ceil(size / 512) * 512
    }
    return null
}

export function parseApkIndex (text: string) : Map<string, AlpinePackageInfo> {
    const packages = new Map<string, AlpinePackageInfo>()
    for (const block of text.split('\n\n')) {
        let name: string | null = null
        const info: AlpinePackageInfo = {}
        for (const line of block.split('\n')) {
            const value = line.slice(2)
            if (line.startsWith('P:')) name = value
            else if (line.startsWith('V:')) info.version = value
            else if (line.startsWith('L:')) info.license = value
            else if (line.startsWith('U:')) info.upstreamUrl = value
            else if (line.startsWith('m:')) {
                // "Full Name <email@host>" -> "Full Name"
                info.maintainerName = value.replace(/\s*<[^>]*>\s*$/, '').trim() || undefined
            }
        }
        if (name) packages.set(name, info)
    }
    return packages
}

async function loadIndex (branch: string, repo: string, arch: string) : Promise<Map<string, AlpinePackageInfo> | null> {
    const key = `${branch}|${repo}|${arch}`
    if (indexCache.has(key)) return indexCache.get(key)
    if (failedKeys.has(key)) return null
    try {
        const url = `${ALPINE_CDN}/${branch}/${repo}/${arch}/APKINDEX.tar.gz`
        console.log(`Fetching Alpine index: ${url}`)
        const gz = await getBuffer(url, { timeoutMs: 30000 })
        const tar = zlib.gunzipSync(gz)
        const member = extractTarMember(tar, 'APKINDEX')
        if (!member) throw new Error('APKINDEX member not found in tar')
        const packages = parseApkIndex(member.toString('utf-8'))
        indexCache.set(key, packages)
        return packages
    } catch (error) {
        console.error(`Error loading Alpine index ${key}:`, (error as Error).message)
        failedKeys.add(key)
        return null
    }
}

// Resolve an apk purl (pkg:apk/alpine/<name>@<ver>?distro=alpine-X.Y...).
// The version in the index is checked against the purl's, but a mismatch
// only logs: license and maintainer are stable enough across point
// releases that the current index remains the best deterministic answer.
export async function resolveOnAlpine (purl: PackageURL) : Promise<AlpinePackageInfo> {
    if (purl.namespace && purl.namespace !== 'alpine') return {}
    const qualifiers: Record<string, string> = purl.qualifiers || {}
    const branch = branchFromDistro(qualifiers['distro'] || qualifiers['distro_name'])
    if (!branch) return {}
    const arch = qualifiers['arch'] || DEFAULT_ARCH
    for (const repo of REPOS) {
        const index = await loadIndex(branch, repo, arch)
        const info = index?.get(purl.name)
        if (info) {
            if (purl.version && info.version && info.version !== purl.version) {
                console.log(`Alpine index version ${info.version} differs from purl ${purl.version} for ${purl.name}`)
            }
            return {
                ...info,
                license: info.license ? (normalizeLicenseString(info.license) || undefined) : undefined
            }
        }
    }
    return {}
}

// test seam
export function _clearAlpineCaches () {
    indexCache.clear()
    failedKeys.clear()
}
