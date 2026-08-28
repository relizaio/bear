// Deterministic supplier resolution by well-known package namespace.
// Keys are matched as case-insensitive substrings of the (decoded) purl, so
// pick them long enough to be unambiguous: npm scopes keep the trailing
// slash, maven groupIds keep a leading slash and trailing dot. Data only -
// review by reading, extend by appending.
export interface NormalizedSupplier {
    name: string
    url: string
    // Optional: set only when the namespace pins a single unambiguous
    // license (e.g. busybox applets are GPL-2.0-only); used as an AUTO
    // license answer when no earlier source produced one.
    license?: string
}

export const SUPPLIER_NORMALIZATIONS: Record<string, NormalizedSupplier> = {
    // vendor keywords appearing in the package name itself
    'microsoft': { name: 'Microsoft', url: 'https://www.microsoft.com' },

    // npm scopes
    '@angular/': { name: 'Google', url: 'https://about.google' },
    '@aws-sdk/': { name: 'Amazon Web Services', url: 'https://aws.amazon.com' },
    '@azure/': { name: 'Microsoft', url: 'https://www.microsoft.com' },
    '@babel/': { name: 'Babel', url: 'https://babeljs.io' },
    '@google-cloud/': { name: 'Google', url: 'https://about.google' },
    '@nestjs/': { name: 'NestJS', url: 'https://nestjs.com' },
    '@types/': { name: 'Microsoft', url: 'https://www.microsoft.com' },
    '@vue/': { name: 'Vue.js', url: 'https://vuejs.org' },

    // maven groupIds (reverse-DNS makes these highly reliable)
    '/com.amazonaws.': { name: 'Amazon Web Services', url: 'https://aws.amazon.com' },
    '/com.fasterxml.jackson': { name: 'FasterXML', url: 'https://fasterxml.com' },
    '/com.google.': { name: 'Google', url: 'https://about.google' },
    '/io.quarkus': { name: 'Red Hat', url: 'https://www.redhat.com' },
    '/org.apache.': { name: 'Apache Software Foundation', url: 'https://www.apache.org' },
    '/org.eclipse.': { name: 'Eclipse Foundation', url: 'https://www.eclipse.org' },
    '/org.jetbrains': { name: 'JetBrains', url: 'https://www.jetbrains.com' },
    '/org.springframework': { name: 'Broadcom', url: 'https://spring.io' },

    // python namespaces
    'pkg:pypi/boto3': { name: 'Amazon Web Services', url: 'https://aws.amazon.com' },
    'pkg:pypi/botocore': { name: 'Amazon Web Services', url: 'https://aws.amazon.com' },
    'pkg:pypi/google-': { name: 'Google', url: 'https://about.google' },

    // npm scopes whose package.json author is a maintainer person or an
    // email rather than the owning organization
    '@rollup/': { name: 'Rollup', url: 'https://rollupjs.org' },
    '@eslint/': { name: 'ESLint', url: 'https://eslint.org' },
    '@apollo/': { name: 'Apollo GraphQL, Inc.', url: 'https://www.apollographql.com' },

    // container-base binaries as scanners emit them (pkg:generic/<name>).
    // Keys are full generic-purl prefixes so short names cannot collide with
    // real package names in other ecosystems. Ambiguous binaries that differ
    // by libc/distro (ldd, ldconfig, iconv, getconf, getent) are deliberately
    // absent: on Alpine they are musl/BusyBox, on Debian glibc/GNU, and a
    // bare purl cannot tell which.
    'pkg:generic/busybox': { name: 'BusyBox', url: 'https://busybox.net', license: 'GPL-2.0-only' },
    'pkg:generic/ssl_client': { name: 'BusyBox', url: 'https://busybox.net', license: 'GPL-2.0-only' },
    'pkg:generic/apk': { name: 'Alpine Linux', url: 'https://alpinelinux.org', license: 'GPL-2.0-only' },
    'pkg:generic/libapk': { name: 'Alpine Linux', url: 'https://alpinelinux.org', license: 'GPL-2.0-only' },
    'pkg:generic/ld-musl-': { name: 'musl libc', url: 'https://musl.libc.org', license: 'MIT' },
    'pkg:generic/libcrypto': { name: 'OpenSSL Software Foundation', url: 'https://openssl.org', license: 'Apache-2.0' },
    'pkg:generic/libssl': { name: 'OpenSSL Software Foundation', url: 'https://openssl.org', license: 'Apache-2.0' },
    'pkg:generic/libz.so': { name: 'zlib', url: 'https://zlib.net', license: 'Zlib' },
    'pkg:generic/libpcre2': { name: 'PCRE2 Project', url: 'https://pcre2project.github.io/pcre2/', license: 'BSD-3-Clause' },
    'pkg:generic/envsubst': { name: 'GNU Project', url: 'https://www.gnu.org/software/gettext/' },
    'pkg:generic/scanelf': { name: 'Gentoo Foundation', url: 'https://wiki.gentoo.org/wiki/Hardened/PaX_Utilities', license: 'GPL-2.0-only' },
}
