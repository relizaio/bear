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

## Contact Reliza
Easiest way to contact us is through our [Discord Community](https://devopscommunity.org/) - find #rearm channel there and either post in this channel or send a direct message to maintainers.

You can also send us an email to [info@reliza.io](mailto:info@reliza.io).
