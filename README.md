# BEAR - BOM Enrichment and Augmentation by Reliza

## Run via Docker-Compose
### Pre-requisites
You need a Google Gemini AI or an OpenAI API Key.

### Steps
1. Git clone this repository
2. Change directory to `deploy/bear-docker-compose`
3. Create `bear.env` file with the following contents (include only the key or keys you are using, set BEAR_AI_TYPE to either GEMINI or OPENAI accordingly):

```
BEAR_GEMINI_API_KEY="your_actual_api_key"
BEAR_OPENAI_API_KEY="your_actual_api_key"
BEAR_AI_TYPE="OPENAI"
BEAR_GITHUB_TOKEN="optional_no_scope_pat"
```

Optional environment variables:
- `BEAR_GITHUB_TOKEN`: enables the GitHub resolution steps (license detection, license/NOTICE copyright extraction, repo-owner supplier lookup). A personal access token with **no scopes** is sufficient - all data read is public; the token only provides the 5,000 requests/hour authenticated rate limit. Without it, GitHub API steps are skipped (a raw LICENSE-file fallback remains for copyright). In the Helm deployment, add it to the `bear-api-key` secret alongside the AI keys.

Note that this file is added to .gitignore - make sure the secret is not checked in.

4. Perform
```
docker-compose up -d
```

5. You may then access deployment on `http://localhost:8086/graphql`

6. Try sample query:

```
mutation resolveSupplier($purl: String!) {
    resolveSupplier(purl: $purl) {
        name
        address {
          country
          region
          locality
          postOfficeBoxNumber
          postalCode
          streetAddress
        }
        url
        contact {
          name
          email
          phone
        }
    }
}
```

with query variables:

{
  "purl": "pkg:npm/%40graphql-tools/schema@9.0.18#packages/schema"
}

If everything works, you can then use [ReARM CLI](https://github.com/relizaio/rearm-cli?tab=readme-ov-file#92-bom-supplier-enrichment-with-bear) to interact with BEAR instance.

## Resolution Flows

BEAR uses a multi-tiered resolution strategy for enriching BOM components with supplier, license, and copyright information. Each field follows a specific priority order to ensure the most accurate and authoritative data is used.

### Supplier Resolution Flow

```
1. Database Check
   └─ If supplier exists in DB → use cached value
       ↓ (if not found)
2. AUTO Resolution (data-driven normalization table)
   └─ src/data/supplierNormalizations.ts: npm scopes, maven groupIds,
      pypi namespaces, vendor keywords, container-base binaries
      (pkg:generic busybox applets, musl, OpenSSL libs, ...); entries may
      also pin an unambiguous license
       ↓ (if not found)
3. Ecosystem Registry
   └─ npm author (email-shaped author names rejected) / PyPI author /
      crates.io owner / RubyGems authors / Maven POM <organization> /
      NuGet catalog authors / Alpine APKINDEX maintainer (apk)
   └─ Source: NPM, PYPI, CRATES, RUBYGEMS, MAVEN, NUGET, or ALPINE
       ↓ (if not found)
4. GitHub Repo Owner (requires BEAR_GITHUB_TOKEN)
   └─ /orgs/{owner} (fallback /users/{owner}) of the source repo
   └─ Source: GITHUB
       ↓ (if not found)
5. ClearlyDefined API
   └─ Extract from described.sourceLocation (GitHub namespace)
   └─ Validate: reject if name is "OTHER", "NOASSERTION", or "NONE"
       ↓ (if not found or invalid)
6. AI Fallback
   └─ Gemini or OpenAI returns JSON with supplier info and confidence score
   └─ Reject if confidence < 0.6 or response contains invalid phrases
   └─ Source: GEMINI or OPENAI
```

### License Resolution Flow

```
1. Database Check
   └─ If license exists in DB → use cached value
       ↓ (if not found)
2. AUTO Resolution (Hardcoded Rules)
   └─ Check for known patterns (e.g., "Microsoft.AspNetCore" → "MIT")
       ↓ (if not found)
3. Ecosystem Registry
   └─ npm license / PyPI classifiers / crates.io / RubyGems / Maven POM
      <licenses> / NuGet licenseExpression / Alpine APKINDEX L: field (apk)
   └─ Free-text names normalized to SPDX via an explicit, unambiguous-only
      mapping table (a wrong SPDX id is worse than none)
   └─ Source: NPM, PYPI, CRATES, RUBYGEMS, MAVEN, NUGET, or ALPINE
       ↓ (if not found)
4. deps.dev, then GitHub License Detection (requires BEAR_GITHUB_TOKEN)
   └─ /repos/{owner}/{repo}/license returns the SPDX id detected on the
      default branch, whatever the license file is named
   └─ Source: DEPSDEV or GITHUB
       ↓ (if not found)
5. ClearlyDefined API
   └─ Extract from licensed.declared
   └─ Detect AND/OR operators → store as expression vs. single ID
   └─ Validate: reject if contains "LicenseRef", "OTHER", "NOASSERTION", or "NONE"
       ↓ (if not found or invalid)
6. AI Fallback
   └─ Gemini or OpenAI returns JSON with SPDX license identifier and confidence score
   └─ Reject if confidence < 0.6 or response contains invalid phrases
   └─ Detect AND/OR operators in AI response
   └─ Source: GEMINI or OPENAI
```

### Copyright Resolution Flow

```
1. Database Check
   └─ If copyright exists in DB → use cached value
       ↓ (if not found)
2. NuGet API (for pkg:nuget/* only)
   └─ Catalog entry's declared copyright field
   └─ Source: NUGET
       ↓ (if not found or non-nuget package)
3. GitHub License / NOTICE Extraction (requires BEAR_GITHUB_TOKEN)
   └─ Short permissive licenses (MIT, BSD-*, ISC, Zlib, ...): copyright
      lines extracted from the license file itself; ALL stacked notices
      are kept, newline-joined
   └─ Apache-2.0: extracted from the NOTICE file (the Apache LICENSE text
      carries no project copyright)
   └─ Copyleft (GPL/LGPL/MPL): deliberately skipped - their license files
      carry the FSF's copyright, not the project's
   └─ Without a token: raw LICENSE fetch fallback on main/master
   └─ Source: GITHUB
       ↓ (if not found)
4. ClearlyDefined API
   └─ licensed.facets.core.attribution.parties, filtered
      deterministically: undated noise dropped, near-duplicates merged,
      every surviving distinct notice kept
   └─ Source: CLEARLYDEFINED
       ↓ (if not found)
5. Empty
   └─ No AI: an unresolvable copyright stays unset rather than becoming a
      model's guess at a legal notice
```

### Source Type Tracking

Each resolved field is tagged with its source:
- `AUTO`: Normalization table or hardcoded rule
- `NPM` / `PYPI` / `CRATES` / `RUBYGEMS` / `MAVEN` / `NUGET` / `ALPINE`: ecosystem registry (ALPINE = Alpine's APKINDEX, cached per branch/repo/arch)
- `GITHUB`: GitHub API (owner profile, license detection, license/NOTICE extraction)
- `DEPSDEV`: deps.dev API
- `CLEARLYDEFINED`: ClearlyDefined API
- `GEMINI`: Google Gemini AI (supplier/license residue only)
- `OPENAI`: OpenAI AI (supplier/license residue only)

This information is stored in the `sources` field as:
```json
{
  "supplier": "CLEARLYDEFINED",
  "license": "CLEARLYDEFINED",
  "copyright": "NUGET"
}
```

### ClearlyDefined Resolution

BEAR queries the public ClearlyDefined API (`https://api.clearlydefined.io`) with a 10-second timeout, a single call per component.

### AI Response Validation

All AI responses are requested as JSON with a `confidence` field (float 0-1). BEAR validates AI responses by:
1. Checking for invalid phrases (e.g., "cannot determine", "unable to") and single-quote characters
2. Parsing the JSON response and extracting the `confidence` score
3. Rejecting responses with confidence below `0.6`
4. Stripping the `confidence` field before storage

### AI Model Selection

- Uses default models (`gemini-2.0-flash`, `gpt-5.4`), applied only to the
  supplier/license residue that every deterministic source has passed on.
  Copyright resolution uses no AI.

## Contact Reliza
Easiest way to contact us is through our [Discord Community](https://devopscommunity.org/) - find #rearm channel there and either post in this channel or send a direct message to maintainers.

You can also send us an email to [info@reliza.io](mailto:info@reliza.io).
