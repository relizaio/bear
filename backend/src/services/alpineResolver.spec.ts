// Tests for the Alpine APKINDEX resolver: tar/gzip handling against a
// synthetic index built in-test, branch parsing, caching, and fail-soft.
import * as zlib from 'node:zlib'
import { PackageURL } from 'packageurl-js'
import { resolveOnAlpine, parseApkIndex, extractTarMember, branchFromDistro, _clearAlpineCaches } from './alpineResolver'

// Build a minimal valid ustar archive containing one member
function makeTar (name: string, content: Buffer) : Buffer {
    const header = Buffer.alloc(512)
    header.write(name, 0)
    header.write('0000644\0', 100)              // mode
    header.write('0000000\0', 108)              // uid
    header.write('0000000\0', 116)              // gid
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136)          // mtime
    header.write('        ', 148)               // checksum placeholder
    header.write('0', 156)                      // typeflag
    header.write('ustar', 257)
    let sum = 0
    for (const b of header) sum += b
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
    content.copy(padded)
    return Buffer.concat([header, padded, Buffer.alloc(1024)])
}

const SAMPLE_INDEX = `C:Q1abc=
P:busybox
V:1.37.0-r31
A:x86_64
L:GPL-2.0-only
m:Sören Tempel <soeren@soeren-tempel.net>
U:https://busybox.net/

C:Q1def=
P:zlib
V:1.3.2-r0
L:Zlib
U:https://zlib.net/
`

describe('alpineResolver', () => {
    const realFetch = global.fetch

    afterEach(() => {
        global.fetch = realFetch
        _clearAlpineCaches()
        jest.restoreAllMocks()
    })

    it('branchFromDistro maps distro qualifiers to index branches', () => {
        expect(branchFromDistro('alpine-3.24.1')).toBe('v3.24')
        expect(branchFromDistro('alpine-3.24')).toBe('v3.24')
        expect(branchFromDistro('debian-12')).toBeNull()
        expect(branchFromDistro(undefined)).toBeNull()
    })

    it('parseApkIndex reads P/V/L/m/U and strips maintainer emails', () => {
        const idx = parseApkIndex(SAMPLE_INDEX)
        expect(idx.get('busybox')).toEqual({
            version: '1.37.0-r31', license: 'GPL-2.0-only',
            maintainerName: 'Sören Tempel', upstreamUrl: 'https://busybox.net/'
        })
        expect(idx.get('zlib').maintainerName).toBeUndefined()
    })

    it('extractTarMember walks a real ustar archive', () => {
        const tar = makeTar('APKINDEX', Buffer.from(SAMPLE_INDEX))
        expect(extractTarMember(tar, 'APKINDEX').toString()).toBe(SAMPLE_INDEX)
        expect(extractTarMember(tar, 'MISSING')).toBeNull()
    })

    it('resolves an apk purl end-to-end from a gzipped index, then serves cache', async () => {
        const gz = zlib.gzipSync(makeTar('APKINDEX', Buffer.from(SAMPLE_INDEX)))
        const fn = jest.fn().mockResolvedValue({
            ok: true, status: 200,
            arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)
        })
        global.fetch = fn as any
        const purl = PackageURL.fromString('pkg:apk/alpine/busybox@1.37.0-r31?arch=x86_64&distro=alpine-3.24.1')
        const r = await resolveOnAlpine(purl)
        expect(r.license).toBe('GPL-2.0-only')
        expect(r.maintainerName).toBe('Sören Tempel')
        expect(fn.mock.calls[0][0]).toContain('/v3.24/main/x86_64/APKINDEX.tar.gz')

        // second package, same index: no additional fetch
        const r2 = await resolveOnAlpine(PackageURL.fromString('pkg:apk/alpine/zlib@1.3.2-r0?arch=x86_64&distro=alpine-3.24.1'))
        expect(r2.license).toBe('Zlib')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('returns empty without a distro qualifier, and caches fetch failures', async () => {
        expect(await resolveOnAlpine(PackageURL.fromString('pkg:apk/alpine/busybox@1.37.0-r31'))).toEqual({})
        const fn = jest.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
        global.fetch = fn as any
        const purl = PackageURL.fromString('pkg:apk/alpine/busybox@1?distro=alpine-9.99')
        expect(await resolveOnAlpine(purl)).toEqual({})
        const callsAfterFirst = fn.mock.calls.length   // main + community tried once each
        expect(await resolveOnAlpine(purl)).toEqual({})
        expect(fn.mock.calls.length).toBe(callsAfterFirst)  // failures cached, no re-fetch
    })
})
