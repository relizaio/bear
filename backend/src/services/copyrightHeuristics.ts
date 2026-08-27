// Pure, deterministic copyright and license-string logic. No I/O - every
// function here is directly unit-testable. This module replaces the AI
// copyright paths: extraction reads notices out of license/NOTICE text,
// selection filters and dedupes multi-candidate lists.

// License families whose LICENSE file conventionally begins with the
// project's own copyright notice (family A). Copyleft licenses are
// deliberately absent: their license files carry the FSF's copyright, not
// the project's, so extracting from them would be wrong. Apache-2.0 is
// handled separately via the NOTICE file convention.
export const COPYRIGHT_EXTRACTABLE_LICENSES = new Set([
    'MIT', 'MIT-0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear',
    'ISC', 'NCSA', 'BSL-1.0', 'Zlib', '0BSD', 'X11'
])

export const NOTICE_FILE_LICENSES = new Set(['Apache-2.0'])

const COPYRIGHT_LINE = /copyright\s+(?:\(c\)|©|\(C\))?\s*\d{4}/i
const PLACEHOLDER = /\[(?:year|yyyy|xxxx|fullname|owner|name|copyright holders?)\]|<(?:year|yyyy|fullname|owner|name|copyright holders?)>/i

// Extract every real, dated copyright line from a license or NOTICE text.
// Long-lived projects and forks legitimately stack several notices; keep
// them all (newline-joined) rather than silently choosing one.
export function extractCopyrightLines (text: string) : string | null {
    if (!text) return null
    const seen = new Set<string>()
    const lines: string[] = []
    for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (!COPYRIGHT_LINE.test(line) || PLACEHOLDER.test(line)) continue
        const key = line.toLowerCase().replace(/\s+/g, ' ')
        if (seen.has(key)) continue
        seen.add(key)
        lines.push(line)
    }
    return lines.length ? lines.join('\n') : null
}

// Deterministic replacement for AI candidate selection (e.g. ClearlyDefined
// attribution parties): drop undated noise and near-duplicates, keep every
// surviving distinct notice.
export function selectCopyrights (candidates: string[]) : string | null {
    if (!candidates || !candidates.length) return null
    const seen = new Set<string>()
    const kept: string[] = []
    for (const raw of candidates) {
        const line = (raw || '').trim()
        if (!line) continue
        // undated fragments ("All rights reserved.", bare names) carry no
        // attributable notice; dated lines are the signal
        if (!COPYRIGHT_LINE.test(line) || PLACEHOLDER.test(line)) continue
        const key = line.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '')
        if (seen.has(key)) continue
        seen.add(key)
        kept.push(line)
    }
    return kept.length ? kept.join('\n') : null
}

// Free-text license names that unambiguously map to one SPDX id. Anything
// ambiguous (bare "BSD", "GPL") is deliberately NOT mapped - a wrong SPDX id
// is worse than none. Keys are matched lowercased and trimmed.
const SPDX_NORMALIZATIONS: Record<string, string> = {
    'apache 2.0': 'Apache-2.0',
    'apache 2': 'Apache-2.0',
    'apache-2': 'Apache-2.0',
    'apache license 2.0': 'Apache-2.0',
    'apache license, version 2.0': 'Apache-2.0',
    'the apache software license, version 2.0': 'Apache-2.0',
    'apache software license - version 2.0': 'Apache-2.0',
    'mit license': 'MIT',
    'the mit license': 'MIT',
    'the mit license (mit)': 'MIT',
    'bsd 3-clause': 'BSD-3-Clause',
    'bsd 3-clause license': 'BSD-3-Clause',
    'the 3-clause bsd license': 'BSD-3-Clause',
    'new bsd license': 'BSD-3-Clause',
    'bsd 2-clause': 'BSD-2-Clause',
    'simplified bsd license': 'BSD-2-Clause',
    'isc license': 'ISC',
    'the unlicense': 'Unlicense',
    'mozilla public license 2.0': 'MPL-2.0',
    'mozilla public license, version 2.0': 'MPL-2.0',
    'eclipse public license 2.0': 'EPL-2.0',
    'eclipse public license - v 2.0': 'EPL-2.0',
    'eclipse public license 1.0': 'EPL-1.0',
    'eclipse public license - v 1.0': 'EPL-1.0',
    'gnu lesser general public license v2.1': 'LGPL-2.1-only',
    'gnu lesser general public license v3.0': 'LGPL-3.0-only',
    'python software foundation license': 'PSF-2.0',
}

// SPDX ids are short tokens without spaces; free text has spaces/commas.
const SPDX_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/

// Normalize a license string from a registry: pass through anything already
// shaped like an SPDX id or expression, map known free-text names, otherwise
// return null so the caller treats the value as unusable.
export function normalizeLicenseString (value: string) : string | null {
    if (!value) return null
    const trimmed = value.trim()
    if (SPDX_ID_SHAPE.test(trimmed)) return trimmed
    if (/ (AND|OR|WITH) /.test(trimmed) && !trimmed.includes(',')) return trimmed
    return SPDX_NORMALIZATIONS[trimmed.toLowerCase()] || null
}

// PyPI trove classifier -> SPDX, for the classifiers that are unambiguous.
const CLASSIFIER_TO_SPDX: Record<string, string> = {
    'license :: osi approved :: mit license': 'MIT',
    'license :: osi approved :: isc license (iscl)': 'ISC',
    'license :: osi approved :: mozilla public license 2.0 (mpl 2.0)': 'MPL-2.0',
    'license :: osi approved :: gnu lesser general public license v2 or later (lgplv2+)': 'LGPL-2.0-or-later',
    // NOTE: the generic 'BSD License' and 'Apache Software License'
    // classifiers do not pin a version and are deliberately unmapped.
}

export function licenseFromPypiClassifiers (classifiers: string[]) : string | null {
    if (!classifiers) return null
    for (const c of classifiers) {
        const mapped = CLASSIFIER_TO_SPDX[c.trim().toLowerCase()]
        if (mapped) return mapped
    }
    return null
}
