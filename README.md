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
- `BEAR_CLEARLYDEFINED_API_URI`: Use a custom ClearlyDefined instance. Defaults to `https://api.clearlydefined.io`. When using a non-public instance, BEAR will automatically try the public API as fallback, then trigger the harvest endpoint for packages with zero scores and retry up to 10 times.
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
3. ClearlyDefined API
   └─ Extract from licensed.declared
   └─ Detect AND/OR operators → store as expression vs. single ID
   └─ Validate: reject if contains "LicenseRef", "OTHER", "NOASSERTION", or "NONE"
       ↓ (if not found or invalid)
4. AI Fallback
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
   └─ Gemini or OpenAI returns JSON with copyright notice and confidence score
   └─ Reject if confidence < 0.6 or response contains invalid phrases
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

### ClearlyDefined Resolution Flow

BEAR uses a multi-step approach to resolve data from ClearlyDefined:
1. Call the configured ClearlyDefined API (private instance if set via `BEAR_CLEARLYDEFINED_API_URI`)
2. If no valid score, call the public ClearlyDefined API (`https://api.clearlydefined.io`) with a 10-second timeout
3. If still no valid score and using a non-public instance, trigger the harvest endpoint and retry up to 10 times with 6-second intervals
4. Use the best available data once resolved

### AI Response Validation

All AI responses are requested as JSON with a `confidence` field (float 0-1). BEAR validates AI responses by:
1. Checking for invalid phrases (e.g., "cannot determine", "unable to") and single-quote characters
2. Parsing the JSON response and extracting the `confidence` score
3. Rejecting responses with confidence below `0.6`
4. Stripping the `confidence` field before storage

### AI Model Selection

- **Standard resolution**: Uses default models (`gemini-2.0-flash`, `gpt-5.2`)
- **Copyright resolution**: Uses configurable models via `BEAR_GEMINI_COPYRIGHT_MODEL` and `BEAR_OPENAI_COPYRIGHT_MODEL`
  - Recommended: `gemini-2.0-flash-thinking-exp` or `o1` for better accuracy
  - OpenAI requests include `reasoning: { effort: "medium" }` parameter

## Contact Reliza
Easiest way to contact us is through our [Discord Community](https://devopscommunity.org/) - find #rearm channel there and either post in this channel or send a direct message to maintainers.

You can also send us an email to [info@reliza.io](mailto:info@reliza.io).
