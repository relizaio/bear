// Deterministic supplier resolution by well-known package namespace.
// Keys are matched as case-insensitive substrings of the (decoded) purl, so
// pick them long enough to be unambiguous: npm scopes keep the trailing
// slash, maven groupIds keep a leading slash and trailing dot. Data only -
// review by reading, extend by appending.
export interface NormalizedSupplier {
    name: string
    url: string
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
}
