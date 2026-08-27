import {
    COPYRIGHT_EXTRACTABLE_LICENSES, NOTICE_FILE_LICENSES,
    extractCopyrightLines, selectCopyrights,
    normalizeLicenseString, licenseFromPypiClassifiers
} from './copyrightHeuristics'

describe('copyrightHeuristics', () => {
    describe('extractCopyrightLines', () => {
        it('extracts a single dated notice', () => {
            const mit = 'MIT License\n\nCopyright (c) 2019 Acme Corp\n\nPermission is hereby granted...'
            expect(extractCopyrightLines(mit)).toBe('Copyright (c) 2019 Acme Corp')
        })
        it('keeps ALL stacked notices, newline-joined, in file order', () => {
            const text = 'Copyright (c) 2010 Original Author\nCopyright (c) 2015-2020 Fork Maintainers\nPermission is hereby granted'
            expect(extractCopyrightLines(text)).toBe('Copyright (c) 2010 Original Author\nCopyright (c) 2015-2020 Fork Maintainers')
        })
        it('dedupes whitespace-variant duplicates', () => {
            const text = 'Copyright (c) 2020 Acme\nCopyright (c)  2020  Acme'
            expect(extractCopyrightLines(text)).toBe('Copyright (c) 2020 Acme')
        })
        it('rejects template placeholders and undated lines', () => {
            expect(extractCopyrightLines('Copyright (c) 2019 [fullname]')).toBeNull()
            expect(extractCopyrightLines('Copyright (c) <year> <owner>')).toBeNull()
            expect(extractCopyrightLines('Copyright Acme Corp. All rights reserved.')).toBeNull()
            expect(extractCopyrightLines('')).toBeNull()
        })
    })

    describe('selectCopyrights (deterministic replacement for AI selection)', () => {
        it('drops undated noise, keeps every distinct dated notice', () => {
            const out = selectCopyrights([
                'Copyright (c) 2018 Alpha',
                'All rights reserved.',
                'copyright (C) 2018 alpha',       // near-duplicate, case/punct
                'Copyright (c) 2021 Beta Inc.',
            ])
            expect(out).toBe('Copyright (c) 2018 Alpha\nCopyright (c) 2021 Beta Inc.')
        })
        it('returns null when nothing survives', () => {
            expect(selectCopyrights(['All rights reserved', 'Acme'])).toBeNull()
            expect(selectCopyrights([])).toBeNull()
        })
    })

    describe('license family sets', () => {
        it('family A is permissive-only; copyleft is deliberately absent', () => {
            expect(COPYRIGHT_EXTRACTABLE_LICENSES.has('MIT')).toBe(true)
            expect(COPYRIGHT_EXTRACTABLE_LICENSES.has('Zlib')).toBe(true)
            for (const copyleft of ['GPL-2.0-only', 'GPL-3.0-only', 'LGPL-3.0-only', 'MPL-2.0', 'AGPL-3.0-only']) {
                expect(COPYRIGHT_EXTRACTABLE_LICENSES.has(copyleft)).toBe(false)
            }
        })
        it('Apache-2.0 routes to the NOTICE convention, not license-file extraction', () => {
            expect(COPYRIGHT_EXTRACTABLE_LICENSES.has('Apache-2.0')).toBe(false)
            expect(NOTICE_FILE_LICENSES.has('Apache-2.0')).toBe(true)
        })
    })

    describe('normalizeLicenseString', () => {
        it('passes through SPDX-shaped ids and expressions', () => {
            expect(normalizeLicenseString('Apache-2.0')).toBe('Apache-2.0')
            expect(normalizeLicenseString('MIT OR GPL-2.0-only')).toBe('MIT OR GPL-2.0-only')
        })
        it('maps known free-text names', () => {
            expect(normalizeLicenseString('The Apache Software License, Version 2.0')).toBe('Apache-2.0')
            expect(normalizeLicenseString('The MIT License (MIT)')).toBe('MIT')
            expect(normalizeLicenseString('Eclipse Public License - v 2.0')).toBe('EPL-2.0')
        })
        it('refuses ambiguous free text rather than guessing', () => {
            expect(normalizeLicenseString('BSD style license')).toBeNull()
            expect(normalizeLicenseString('GNU General Public License')).toBeNull()
            expect(normalizeLicenseString('')).toBeNull()
        })
    })

    describe('licenseFromPypiClassifiers', () => {
        it('maps unambiguous classifiers', () => {
            expect(licenseFromPypiClassifiers(['Development Status :: 5 - Production/Stable', 'License :: OSI Approved :: MIT License'])).toBe('MIT')
        })
        it('refuses versionless classifiers (BSD, Apache)', () => {
            expect(licenseFromPypiClassifiers(['License :: OSI Approved :: BSD License'])).toBeNull()
            expect(licenseFromPypiClassifiers(['License :: OSI Approved :: Apache Software License'])).toBeNull()
            expect(licenseFromPypiClassifiers(undefined as any)).toBeNull()
        })
    })
})
