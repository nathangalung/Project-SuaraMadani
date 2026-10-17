-- Superuser bootstrap: roles, extensions
\set ON_ERROR_STOP on

-- Passwords from environment only
\getenv migrator_pw SM_MIGRATOR_PASSWORD
\getenv app_pw SM_APP_PASSWORD
\getenv media_pw SM_MEDIA_PASSWORD
\getenv backup_pw SM_BACKUP_PASSWORD
\getenv app_db SM_DATABASE
\getenv test_db SM_TEST_DATABASE

CREATE ROLE sm_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'migrator_pw';
CREATE ROLE sm_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'app_pw';
CREATE ROLE sm_media LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'media_pw';
CREATE ROLE sm_backup LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'backup_pw';
CREATE ROLE sm_aggregates NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB;

-- Migrator transfers view ownership
GRANT sm_aggregates TO sm_migrator;

SELECT format('ALTER DATABASE %I OWNER TO sm_migrator', :'app_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sm_app, sm_media, sm_backup', :'app_db') \gexec

\connect :app_db
-- Drop image extras, keep three
DROP EXTENSION IF EXISTS postgis_tiger_geocoder;
DROP EXTENSION IF EXISTS postgis_topology;
DROP EXTENSION IF EXISTS fuzzystrmatch;
DROP SCHEMA IF EXISTS tiger CASCADE;
DROP SCHEMA IF EXISTS tiger_data CASCADE;
DROP SCHEMA IF EXISTS topology CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- Only superuser and pg_read_all_stats
REVOKE ALL ON pg_stat_statements, pg_stat_statements_info FROM PUBLIC;
ALTER SCHEMA public OWNER TO sm_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sm_app, sm_media, sm_backup;

-- Optional test clone, dev only
\connect postgres
\if :{?test_db}
SELECT format('CREATE DATABASE %I TEMPLATE %I OWNER sm_migrator', :'test_db', :'app_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'test_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sm_app, sm_media, sm_backup', :'test_db') \gexec
\endif
