# syntax=docker/dockerfile:1
# PostGIS 18-3.6 plus pgBackRest
FROM postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677
# Same date as infra/Dockerfile
ARG DEBIAN_SECURITY_SNAPSHOT=20261016T152439Z
# Fails the build on drift
ARG PGBACKREST_VERSION=2.59.3-1.pgdg13+1
# Debian fixes only, pgdg untouched
RUN snapshot="$(sed -n 's|^# http://snapshot.debian.org/archive/debian/\([0-9]*T[0-9]*Z\)$|\1|p' /etc/apt/sources.list.d/debian.sources)" \
  && test -n "$snapshot" \
  && expr "$DEBIAN_SECURITY_SNAPSHOT" : '[0-9]\{8\}T[0-9]\{6\}Z$' >/dev/null \
  && printf 'APT::Snapshot "%s";\nAcquire::Check-Valid-Until "false";\n' "$snapshot" \
    >/etc/apt/apt.conf.d/50snapshot \
  && sed -i "\|^URIs: http://deb.debian.org/debian-security\$|a Snapshot: $DEBIAN_SECURITY_SNAPSHOT" \
    /etc/apt/sources.list.d/debian.sources \
  && grep -q "^Snapshot: $DEBIAN_SECURITY_SNAPSHOT\$" /etc/apt/sources.list.d/debian.sources \
  && mv /etc/apt/sources.list.d/pgdg.list /tmp/pgdg.list \
  && apt-get update \
  && apt-get upgrade -y \
  && mv /tmp/pgdg.list /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    pgbackrest \
  && test "$(dpkg-query -W -f='${Version}' pgbackrest)" = "$PGBACKREST_VERSION" \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest
COPY initdb.sql /docker-entrypoint-initdb.d/20-init.sql
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY pg-hba.conf /etc/postgresql/pg_hba.conf
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
