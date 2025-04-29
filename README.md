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
```

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

## Contact Reliza
Easiest way to contact us is through our [Discord Community](https://devopscommunity.org/) - find #rearm channel there and either post in this channel or send a direct message to maintainers.

You can also send us an email to [info@reliza.io](mailto:info@reliza.io).
