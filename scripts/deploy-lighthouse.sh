#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly REPOSITORY_URL="https://github.com/irenex107-code/YouthTempo.git"
readonly DEPLOY_ROOT="/opt/youthtempo"
readonly REPOSITORY_DIR="${DEPLOY_ROOT}/repository"
readonly ENV_FILE="${DEPLOY_ROOT}/.env.production"
readonly LOCK_FILE="${DEPLOY_ROOT}/deploy.lock"
readonly CURRENT_RELEASE_FILE="${DEPLOY_ROOT}/current-release"
readonly PRIMARY_CONTAINER="youthtempo"
readonly CANDIDATE_CONTAINER="youthtempo-candidate"
readonly PRIMARY_PORT="3000"
readonly CANDIDATE_PORT="3001"

commit_sha="${1:-}"

if [[ ! "${commit_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Deployment requires a full 40-character lowercase commit SHA." >&2
  exit 64
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Production environment file is missing or unreadable." >&2
  exit 65
fi

mkdir -p "${DEPLOY_ROOT}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 75
fi

cleanup_candidate() {
  docker rm -f "${CANDIDATE_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT

wait_for_http() {
  local port="$1"
  local attempt

  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${port}/api/health" \
      | grep --quiet '"status":"ok"'; then
      return 0
    fi
    sleep 2
  done

  return 1
}

if [[ ! -d "${REPOSITORY_DIR}/.git" ]]; then
  rm -rf "${REPOSITORY_DIR}"
  git clone --filter=blob:none --no-checkout "${REPOSITORY_URL}" "${REPOSITORY_DIR}"
fi

git -C "${REPOSITORY_DIR}" remote set-url origin "${REPOSITORY_URL}"
git -C "${REPOSITORY_DIR}" fetch --force --prune origin main

if ! git -C "${REPOSITORY_DIR}" cat-file -e "${commit_sha}^{commit}" 2>/dev/null; then
  echo "Requested commit is not available from origin/main." >&2
  exit 66
fi

if ! git -C "${REPOSITORY_DIR}" merge-base --is-ancestor \
  "${commit_sha}" "origin/main"; then
  echo "Requested commit is not part of origin/main." >&2
  exit 67
fi

git -C "${REPOSITORY_DIR}" checkout --detach --force "${commit_sha}"
git -C "${REPOSITORY_DIR}" clean -ffd

readonly short_sha="${commit_sha:0:12}"
readonly image_name="youthtempo:${short_sha}"

echo "Building ${image_name}."
docker build --pull --tag "${image_name}" "${REPOSITORY_DIR}"

cleanup_candidate
docker run --detach \
  --name "${CANDIDATE_CONTAINER}" \
  --restart no \
  --env-file "${ENV_FILE}" \
  --publish "127.0.0.1:${CANDIDATE_PORT}:3000" \
  --label "com.youthtempo.commit=${commit_sha}" \
  "${image_name}" >/dev/null

if ! wait_for_http "${CANDIDATE_PORT}"; then
  echo "Candidate container failed its local health check." >&2
  exit 68
fi

readonly previous_image="$({
  docker inspect --format '{{.Config.Image}}' "${PRIMARY_CONTAINER}" 2>/dev/null || true
} | head -n 1)"

cleanup_candidate
docker rm -f "${PRIMARY_CONTAINER}" >/dev/null 2>&1 || true

docker run --detach \
  --name "${PRIMARY_CONTAINER}" \
  --restart unless-stopped \
  --env-file "${ENV_FILE}" \
  --publish "127.0.0.1:${PRIMARY_PORT}:3000" \
  --label "com.youthtempo.commit=${commit_sha}" \
  "${image_name}" >/dev/null

if ! wait_for_http "${PRIMARY_PORT}"; then
  echo "New release failed after cutover; restoring the previous image." >&2
  docker rm -f "${PRIMARY_CONTAINER}" >/dev/null 2>&1 || true

  if [[ -n "${previous_image}" ]]; then
    docker run --detach \
      --name "${PRIMARY_CONTAINER}" \
      --restart unless-stopped \
      --env-file "${ENV_FILE}" \
      --publish "127.0.0.1:${PRIMARY_PORT}:3000" \
      "${previous_image}" >/dev/null
    wait_for_http "${PRIMARY_PORT}" || true
  fi

  exit 69
fi

printf '%s\n' "${commit_sha}" >"${CURRENT_RELEASE_FILE}"

# Adopt deployment-script improvements from the verified release for the next run.
if [[ -f "${REPOSITORY_DIR}/scripts/deploy-lighthouse.sh" ]]; then
  install -m 0755 \
    "${REPOSITORY_DIR}/scripts/deploy-lighthouse.sh" \
    "${DEPLOY_ROOT}/bin/deploy-lighthouse.sh.next"
  mv -f \
    "${DEPLOY_ROOT}/bin/deploy-lighthouse.sh.next" \
    "${DEPLOY_ROOT}/bin/deploy-lighthouse.sh"
fi

echo "Deployment ${commit_sha} completed successfully."
