BEAR - Bom Enrichment and Augmentation by Reliza

1. Create a docker container for database
docker run --name bear-postgres -d -p 5441:5432 -e POSTGRES_PASSWORD=password postgres:17

docker run --rm -v $PWD/backend/migrations:/flyway/sql flyway/flyway -url=jdbc:postgresql://host.docker.internal:5441/postgres -user=postgres -password=password -defaultSchema=bear -schemas='bear' migrate

We are using schema first approach.

To generate src/graphql.ts definitions, run

```
ts-node generate-gql-typings
```