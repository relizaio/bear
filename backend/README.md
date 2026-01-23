BEAR - Bom Enrichment and Augmentation by Reliza

## Setup

### 1. Create a docker container for database
```bash
docker run --name bear-postgres -d -p 5441:5432 -e POSTGRES_PASSWORD=password postgres:17
```

### 2. Run migrations
```bash
docker run --rm -v $PWD/backend/migrations:/flyway/sql flyway/flyway -url=jdbc:postgresql://host.docker.internal:5441/postgres -user=postgres -password=password -defaultSchema=bear -schemas='bear' migrate
```

### 3. Generate API Key Hash

The application requires an API key for authentication. You need to generate an Argon2 hash of your API key and provide it via the `BEAR_API_KEY_HASH` environment variable.

Generate a hash using Node.js:
```bash
cd backend
npm install
node -e "const argon2 = require('argon2'); argon2.hash('your-secret-api-key').then(h => console.log(h))"
```

Or using npx without installing:
```bash
npx -y argon2-cli -e "your-secret-api-key"
```

Set the environment variable with the generated hash:
```bash
export BEAR_API_KEY_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'
```

### 4. Start the application
```bash
npm run start:dev
```

## API Authentication

All API requests require the `X-API-Key` header with your API key:
```bash
curl -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key" \
  -d '{"query":"mutation { enrich(purl: \"pkg:nuget/example@1.0.0\") { name } }"}'
```

## Development

We are using schema first approach.

To generate src/graphql.ts definitions, run:
```bash
ts-node generate-gql-typings
```