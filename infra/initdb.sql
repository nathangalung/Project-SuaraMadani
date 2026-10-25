-- Superuser bootstrap: roles, extensions
\set ON_ERROR_STOP on

-- Passwords from environment only
\getenv migrator_pw SB_MIGRATOR_PASSWORD
\getenv app_pw SB_APP_PASSWORD
\getenv media_pw SB_MEDIA_PASSWORD
\getenv backup_pw SB_BACKUP_PASSWORD
\getenv app_db SB_DATABASE
\getenv test_db SB_TEST_DATABASE
-- Phase 2 observability, own databases
\getenv glitchtip_pw GLITCHTIP_DB_PASSWORD
\getenv umami_pw UMAMI_DB_PASSWORD

CREATE ROLE sb_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'migrator_pw';
CREATE ROLE sb_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'app_pw';
CREATE ROLE sb_media LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'media_pw';
CREATE ROLE sb_backup LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'backup_pw';
CREATE ROLE sb_aggregates NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB;

-- Migrator transfers view ownership
GRANT sb_aggregates TO sb_migrator;

SELECT format('ALTER DATABASE %I OWNER TO sb_migrator', :'app_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sb_app, sb_media, sb_backup', :'app_db') \gexec

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
ALTER SCHEMA public OWNER TO sb_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sb_app, sb_media, sb_backup;

-- Optional test clone, dev only
\connect postgres
\if :{?test_db}
SELECT format('CREATE DATABASE %I TEMPLATE %I OWNER sb_migrator', :'test_db', :'app_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'test_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sb_app, sb_media, sb_backup', :'test_db') \gexec
\endif

-- Own role and database each
\if :{?glitchtip_pw}
CREATE ROLE glitchtip LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'glitchtip_pw';
CREATE DATABASE glitchtip OWNER glitchtip;
REVOKE ALL ON DATABASE glitchtip FROM PUBLIC;
\endif
\if :{?umami_pw}
CREATE ROLE umami LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'umami_pw';
CREATE DATABASE umami OWNER umami;
REVOKE ALL ON DATABASE umami FROM PUBLIC;
\endif
