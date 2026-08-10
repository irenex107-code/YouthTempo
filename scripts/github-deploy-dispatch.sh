#!/usr/bin/env bash

set -Eeuo pipefail

read -r action commit_sha extra <<<"${SSH_ORIGINAL_COMMAND:-}"

if [[ "${action:-}" != "deploy" ]] \
  || [[ ! "${commit_sha:-}" =~ ^[0-9a-f]{40}$ ]] \
  || [[ -n "${extra:-}" ]]; then
  echo "This key can only deploy one verified YouthTempo commit." >&2
  exit 64
fi

exec /opt/youthtempo/bin/deploy-lighthouse.sh "${commit_sha}"
