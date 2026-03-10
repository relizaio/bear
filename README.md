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
BEAR_CLEARLYDEFINED_API_URI="https://api.clearlydefined.io"
BEAR_GEMINI_COPYRIGHT_MODEL="gemini-2.0-flash-thinking-exp"
BEAR_OPENAI_COPYRIGHT_MODEL="o1"
```

Optional environment variables:
- `BEAR_CLEARLYDEFINED_API_URI`: Use a custom ClearlyDefined instance. Defaults to `https://api.clearlydefined.io`. When using a non-public instance, BEAR will automatically trigger the harvest endpoint for packages with zero scores and retry up to 30 times.
- `BEAR_GEMINI_COPYRIGHT_MODEL`: Gemini model for copyright selection/resolution. Defaults to `gemini-2.0-flash`. Use `gemini-2.0-flash-thinking-exp` or other thinking models for better accuracy when selecting from multiple copyright options.
- `BEAR_OPENAI_COPYRIGHT_MODEL`: OpenAI model for copyright selection/resolution. Defaults to `gpt-5.2`. Use `o1` or other reasoning models for better accuracy when selecting from multiple copyright options.

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
2. AUTO Resolution (Hardcoded Normalizations)
   └─ Check SUPPLIER_NORMALIZATIONS map (e.g., "microsoft" → "Microsoft")
       ↓ (if not found)
3. ClearlyDefined API
   └─ Extract from described.sourceLocation (GitHub namespace)
   └─ Validate: reject if name is "OTHER", "NOASSERTION", or "NONE"
       ↓ (if not found or invalid)
4. AI Fallback
   └─ Gemini or OpenAI generates supplier information
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
3. ClearlyDefined API
   └─ Extract from licensed.declared
   └─ Detect AND/OR operators → store as expression vs. single ID
   └─ Validate: reject if contains "LicenseRef", "OTHER", "NOASSERTION", or "NONE"
       ↓ (if not found or invalid)
4. AI Fallback
   └─ Gemini or OpenAI generates SPDX license identifier
   └─ Detect AND/OR operators in AI response
   └─ Source: GEMINI or OPENAI
```

### Copyright Resolution Flow

```
1. Database Check
   └─ If copyright exists in DB → use cached value
       ↓ (if not found)
2. NuGet API (for pkg:nuget/* only)
   └─ Call registration endpoint → get catalogEntry URL
   └─ Call catalog endpoint → extract copyright field
   └─ Source: NUGET
       ↓ (if not found or non-nuget package)
3. ClearlyDefined API
   └─ Extract from licensed.facets.core.attribution.parties array
   └─ If 1 copyright → use directly
   └─ If 2+ copyrights → AI selects the correct one (using copyright model)
   └─ Source: CLEARLYDEFINED
       ↓ (if not found)
4. AI Fallback
   └─ Gemini or OpenAI generates copyright notice
   └─ Uses configurable copyright model (supports reasoning models)
   └─ Source: GEMINI or OPENAI
```

### Source Type Tracking

Each resolved field is tagged with its source:
- `AUTO`: Hardcoded normalization or rule
- `CLEARLYDEFINED`: ClearlyDefined API
- `NUGET`: NuGet API
- `GEMINI`: Google Gemini AI
- `OPENAI`: OpenAI AI

This information is stored in the `sources` field as:
```json
{
  "supplier": "CLEARLYDEFINED",
  "license": "CLEARLYDEFINED",
  "copyright": "NUGET"
}
```

### ClearlyDefined Harvest (Non-Public Instances)

When using a custom ClearlyDefined instance (via `BEAR_CLEARLYDEFINED_API_URI`), BEAR automatically:
1. Checks if the package has a valid score (non-zero)
2. If score is zero, triggers the harvest endpoint
3. Retries up to 30 times with 2-second intervals
4. Uses the harvested data once available

### AI Model Selection

- **Standard resolution**: Uses default models (`gemini-2.0-flash`, `gpt-5.4`)
- **Copyright resolution**: Uses configurable models via `BEAR_GEMINI_COPYRIGHT_MODEL` and `BEAR_OPENAI_COPYRIGHT_MODEL`
  - Recommended: `gemini-2.0-flash-thinking-exp` or `o1` for better accuracy
  - OpenAI requests include `reasoning: { effort: "medium" }` parameter

## Contact Reliza
Easiest way to contact us is through our [Discord Community](https://devopscommunity.org/) - find #rearm channel there and either post in this channel or send a direct message to maintainers.

You can also send us an email to [info@reliza.io](mailto:info@reliza.io).
