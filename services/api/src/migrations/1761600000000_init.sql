-- Up Migration

-- microshort 2 initial schema. All tables are owned by api; no other service
-- connects to this database.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(254) NOT NULL,
    password_hash TEXT         NOT NULL,
    role          TEXT         NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: Alice@x.be and alice@x.be are the same account.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE api_keys (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    key_hash     CHAR(64)     NOT NULL UNIQUE,   -- SHA-256 hex of the plaintext key
    key_prefix   VARCHAR(12)  NOT NULL,          -- first characters, for display only
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX api_keys_user_id_idx ON api_keys (user_id);

CREATE TABLE urls (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug        VARCHAR(50) NOT NULL UNIQUE,
    long_url    TEXT        NOT NULL,
    click_count BIGINT      NOT NULL DEFAULT 0,  -- denormalised; updated with each click batch
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX urls_user_id_idx    ON urls (user_id);
CREATE INDEX urls_created_at_idx ON urls (created_at DESC);
-- Deliberately NO index on long_url: admin search uses ILIKE and is the
-- "find the slow query" exercise in the load-testing assignment.

CREATE TABLE clicks (
    id         BIGSERIAL PRIMARY KEY,
    url_id     BIGINT      NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    ts         TIMESTAMPTZ NOT NULL,
    referrer   TEXT,
    user_agent TEXT,
    ip_hash    CHAR(64)
);

CREATE INDEX clicks_url_id_ts_idx ON clicks (url_id, ts DESC);
CREATE INDEX clicks_ts_idx        ON clicks (ts DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER urls_set_updated_at BEFORE UPDATE ON urls
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE clicks;
DROP TABLE urls;
DROP TABLE api_keys;
DROP TABLE users;
DROP FUNCTION set_updated_at;
