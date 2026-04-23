#!/usr/bin/env bash
# deploy.sh — One-shot provisioner for the Post-Visit Summary demo.
#
# Deploys:
#   1. Foundation infra (main.bicep): ACR, CAE, Postgres, Key Vault
#   2. Builds & pushes the API container image to ACR
#   3. Container App (containerapp.bicep): pvs-api + Easy Auth
#   4. Postgres firewall rule for Container Apps outbound IPs
#
# Prerequisites:
#   - az cli logged in: az login && az account set -s <sub>
#   - Docker running (for image build)
#   - The repo root as PWD (or pass --root)
#
# Usage:
#   cd <repo-root>
#   bash infra/deploy.sh                       # full deploy
#   bash infra/deploy.sh --skip-infra           # skip main.bicep, redeploy app only
#   bash infra/deploy.sh --skip-image           # skip image build (use existing :latest)

set -euo pipefail

###############################################################################
# Config — edit these or override via env vars
###############################################################################
RG="${RG:-rg-pvs-demo}"
LOCATION="${LOCATION:-centralus}"
PARAMS_FILE="${PARAMS_FILE:-infra/main.parameters.local.json}"
TENANT_ID="${TENANT_ID:-db05faca-c82a-4b9d-b9c5-0f64b6755421}"

# Entra App Registrations
API_SP_CLIENT_ID="${API_SP_CLIENT_ID:-7aa571fc-1bc1-4792-bdf9-23b731585fc3}"
API_SP_CLIENT_SECRET="${API_SP_CLIENT_SECRET:?Set API_SP_CLIENT_SECRET env var}"

# Image
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

# Flags
SKIP_INFRA=false
SKIP_IMAGE=false
for arg in "$@"; do
  case "$arg" in
    --skip-infra) SKIP_INFRA=true ;;
    --skip-image) SKIP_IMAGE=true ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

###############################################################################
# Helper
###############################################################################
info()  { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

###############################################################################
# 1. Deploy foundation infra (main.bicep)
###############################################################################
if [ "$SKIP_INFRA" = false ]; then
  info "Deploying foundation infra (main.bicep) to $RG..."
  INFRA_OUT=$(az deployment group create \
    --resource-group "$RG" \
    --template-file "$REPO_ROOT/infra/main.bicep" \
    --parameters @"$REPO_ROOT/$PARAMS_FILE" \
    --query 'properties.outputs' \
    --output json)
  ok "Foundation infra deployed."
else
  info "Skipping main.bicep (--skip-infra)."
  INFRA_OUT=$(az deployment group show \
    --resource-group "$RG" \
    --name main \
    --query 'properties.outputs' \
    --output json 2>/dev/null || true)

  # If named deployment 'main' doesn't exist, try getting the latest
  if [ -z "$INFRA_OUT" ] || [ "$INFRA_OUT" = "" ]; then
    INFRA_OUT=$(az deployment group list \
      --resource-group "$RG" \
      --query '[0].properties.outputs' \
      --output json)
  fi
fi

# Parse outputs
ACR_LOGIN_SERVER=$(echo "$INFRA_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['acrLoginServer']['value'])")
ACR_NAME=$(echo "$INFRA_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['acrName']['value'])")
CAE_ID=$(echo "$INFRA_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['caeId']['value'])")
KV_NAME=$(echo "$INFRA_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['kvName']['value'])")
PG_FQDN=$(echo "$INFRA_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['pgFqdn']['value'])")

info "ACR: $ACR_LOGIN_SERVER | KV: $KV_NAME | PG: $PG_FQDN"

###############################################################################
# 2. Build and push API image
###############################################################################
IMAGE_REF="$ACR_LOGIN_SERVER/pvs-api:$IMAGE_TAG"
IMAGE_LATEST="$ACR_LOGIN_SERVER/pvs-api:latest"

if [ "$SKIP_IMAGE" = false ]; then
  info "Logging in to ACR ($ACR_NAME)..."
  az acr login --name "$ACR_NAME"

  info "Building API image ($IMAGE_REF)..."
  docker build -t "$IMAGE_REF" -t "$IMAGE_LATEST" "$REPO_ROOT/backend"

  info "Pushing API image..."
  docker push "$IMAGE_REF"
  docker push "$IMAGE_LATEST"
  ok "Image pushed: $IMAGE_REF"
else
  info "Skipping image build (--skip-image). Using $IMAGE_LATEST."
  IMAGE_REF="$IMAGE_LATEST"
fi

###############################################################################
# 3. Deploy Container App (containerapp.bicep)
###############################################################################
info "Deploying Container App (containerapp.bicep)..."
APP_OUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file "$REPO_ROOT/infra/containerapp.bicep" \
  --parameters \
    tenantId="$TENANT_ID" \
    apiSpClientId="$API_SP_CLIENT_ID" \
    apiSpClientSecret="$API_SP_CLIENT_SECRET" \
    caeId="$CAE_ID" \
    acrLoginServer="$ACR_LOGIN_SERVER" \
    acrName="$ACR_NAME" \
    kvName="$KV_NAME" \
    image="$IMAGE_REF" \
    apiCorsOrigins="*" \
  --query 'properties.outputs' \
  --output json)

APP_FQDN=$(echo "$APP_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['appFqdn']['value'])")
APP_URL=$(echo "$APP_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['appUrl']['value'])")
ok "Container App deployed: $APP_URL"

###############################################################################
# 4. Add Postgres firewall rule for Container Apps outbound IPs
###############################################################################
PG_NAME=$(echo "$INFRA_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('pgName',{}).get('value',''))" 2>/dev/null || true)

# Attempt to allow Azure services (may be blocked by UHG policy — non-fatal)
if [ -n "$PG_NAME" ]; then
  info "Adding Postgres firewall rule to allow Azure services..."
  az postgres flexible-server firewall-rule create \
    --resource-group "$RG" \
    --name "$PG_NAME" \
    --rule-name AllowAzureServices \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0 \
    2>/dev/null && ok "Postgres firewall rule added." \
    || info "AllowAzureServices rule blocked by policy (expected). Add Container Apps outbound IPs manually."
fi

###############################################################################
# Summary
###############################################################################
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Deployment complete"
echo "═══════════════════════════════════════════════════════════"
echo "  API URL:   $APP_URL"
echo "  API FQDN:  $APP_FQDN"
echo "  ACR:       $ACR_LOGIN_SERVER"
echo "  Key Vault: $KV_NAME"
echo "  Postgres:  $PG_FQDN"
echo ""
echo "  Next steps:"
echo "    1. Update API_CORS_ORIGINS to your SWA URL once deployed"
echo "    2. Deploy frontend via SWA or Dockerfile.prod"
echo "    3. Bootstrap DB: see Phase 3 in azure-deploy-pvs-4dd724.md"
echo "═══════════════════════════════════════════════════════════"
