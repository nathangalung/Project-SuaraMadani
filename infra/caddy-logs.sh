#!/bin/sh
# Usage: caddy-logs.sh <dir> <minutes>
# Busybox sh, inside caddy
set -eu

dir="$1"
minutes="$2"
# Rolled files, gzipped by Caddy
find "$dir" -name 'access-*.log*' -mmin "-$minutes" | sort |
  while read -r file; do
    case "$file" in
      *.gz) gzip -dc "$file" ;;
      *) cat "$file" ;;
    esac
  done
cat "$dir/access.log"
