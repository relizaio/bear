CREATE TABLE bommeta (
    uuid uuid NOT NULL UNIQUE PRIMARY KEY default gen_random_uuid(),
    created_date timestamptz NOT NULL default now(),
    last_updated_date timestamptz NOT NULL default now(),
    purl text NOT NULL UNIQUE,
    ecosystem text NOT NULL,
    supplier jsonb NULL,
    cdx_schema_version text NOT NULL default '1.6'
);