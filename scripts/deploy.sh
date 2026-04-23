#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build & deploy Post-Visit Summary containers to Azure
#
# Usage:
#   ./scripts/deploy.sh              # auto-detect changes vs last deploy tag
#   ./scripts/deploy.sh api          # force deploy API only
#   ./scripts/deploy.sh web          # force deploy Web only
#   ./scripts/deploy.sh all          # force deploy both
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RG="rg-pvs-demo"
ACR="acrpvsdemos3lshj"
API_APP="pvs-api"
WEB_APP="pvs-web"
API_IMAGE="pvs-api"
WEB_IMAGE="pvs-web"
API_BASE_URL="http://52.176.18.179"

# Image tag = short git sha
TAG=$(git rev-parse --short HEAD)

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
err()   { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

check_az() {
  if ! az account show &>/dev/null; then
    err "Not logged in to Azure. Run: az login"
    exit 1
  fi
}

# ── Detect what changed ──────────────────────────────────────────────────────
detect_changes() {
  local last_tag
  last_tag=$(git tag --list 'deploy-*' --sort=-creatordate | head -1)

  if [[ -z "$last_tag" ]]; then
    info "No previous deploy tag found — deploying both api and web"
    DEPLOY_API=true
    DEPLOY_WEB=true
    return
  fi

  info "Last deploy: $last_tag"
  local diff
  diff=$(git diff --name-only "$last_tag"..HEAD)

  DEPLOY_API=false
  DEPLOY_WEB=false

  if echo "$diff" | grep -q '^backend/'; then
    DEPLOY_API=true
  fi
  if echo "$diff" | grep -q '^web/'; then
    DEPLOY_WEB=true
  fi

  if [[ "$DEPLOY_API" == false && "$DEPLOY_WEB" == false ]]; then
    info "No backend/ or web/ changes since $last_tag"
    info "Use './scripts/deploy.sh all' to force deploy"
    exit 0
  fi
}

# ── Build & Deploy ────────────────────────────────────────────────────────────
deploy_api() {
  info "Building API image ($ACR/$API_IMAGE:$TAG) …"
  az acr build \
    --registry "$ACR" \
    --image "$API_IMAGE:$TAG" \
    --image "$API_IMAGE:latest" \
    ./backend

  info "Deploying API revision …"
  az containerapp update \
    --name "$API_APP" \
    --resource-group "$RG" \
    --image "$ACR.azurecr.io/$API_IMAGE:$TAG" \
    --output none

  ok "API deployed ($API_IMAGE:$TAG)"
}

deploy_web() {
  info "Building Web image ($ACR/$WEB_IMAGE:$TAG) …"
  az acr build \
    --registry "$ACR" \
    --image "$WEB_IMAGE:$TAG" \
    --image "$WEB_IMAGE:latest" \
    --build-arg "VITE_API_BASE_URL=$API_BASE_URL" \
    --file web/Dockerfile.prod \
    ./web

  info "Deploying Web revision …"
  az containerapp update \
    --name "$WEB_APP" \
    --resource-group "$RG" \
    --image "$ACR.azurecr.io/$WEB_IMAGE:$TAG" \
    --output none

  ok "Web deployed ($WEB_IMAGE:$TAG)"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  cd "$(git rev-parse --show-toplevel)"
  check_az

  local mode="${1:-auto}"

  case "$mode" in
    api)
      DEPLOY_API=true; DEPLOY_WEB=false ;;
    web)
      DEPLOY_API=false; DEPLOY_WEB=true ;;
    all)
      DEPLOY_API=true; DEPLOY_WEB=true ;;
    auto|"")
      detect_changes ;;
    *)
      err "Usage: $0 [api|web|all]"
      exit 1 ;;
  esac

  info "Deploy plan: API=$DEPLOY_API  WEB=$DEPLOY_WEB  TAG=$TAG"

  [[ "$DEPLOY_API" == true ]] && deploy_api
  [[ "$DEPLOY_WEB" == true ]] && deploy_web

  # Tag the commit so next run can diff against it
  local deploy_tag="deploy-$(date +%Y%m%d-%H%M%S)"
  git tag "$deploy_tag"
  info "Tagged as $deploy_tag (push with: git push origin $deploy_tag)"

  echo ""
  ok "Deployment complete!"
  echo "   App: $API_BASE_URL"
}

main "$@"
