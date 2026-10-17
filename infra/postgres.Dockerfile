# syntax=docker/dockerfile:1
# PostGIS 18-3.6 plus pgBackRest
FROM postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677
# pgdg indexes latest only
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    pgbackrest \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest
COPY initdb.sql /docker-entrypoint-initdb.d/20-init.sql
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY pg-hba.conf /etc/postgresql/pg_hba.conf
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
