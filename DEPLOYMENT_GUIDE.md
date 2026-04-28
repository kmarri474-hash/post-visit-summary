# Post-Visit Summary — Production Deployment Guide

This guide walks through every step required to deploy the Post-Visit Summary application to a new Azure subscription from scratch. It covers all infrastructure, networking, security, application build, and data seeding steps.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Architecture Overview](#2-architecture-overview)
3. [Variable Reference](#3-variable-reference)
4. [Resource Group](#4-resource-group)
5. [Virtual Network (VNet)](#5-virtual-network-vnet)
6. [Log Analytics Workspace](#6-log-analytics-workspace)
7. [Azure Container Registry (ACR)](#7-azure-container-registry-acr)
8. [PostgreSQL Flexible Server](#8-postgresql-flexible-server)
9. [Private Endpoint — PostgreSQL](#9-private-endpoint--postgresql)
10. [Azure Speech Service](#10-azure-speech-service)
11. [Private Endpoint — Speech Service](#11-private-endpoint--speech-service)
12. [Key Vault](#12-key-vault)
13. [Container Apps Environment](#13-container-apps-environment)
14. [Build & Deploy — Backend (pvs-api)](#14-build--deploy--backend-pvs-api)
15. [Build & Deploy — Frontend (pvs-web)](#15-build--deploy--frontend-pvs-web)
16. [Application Gateway](#16-application-gateway)
17. [TLS / HTTPS Configuration](#17-tls--https-configuration)
18. [Trusted TLS with Let's Encrypt](#18-trusted-tls-with-lets-encrypt)
19. [Database Initialization & Seeding](#19-database-initialization--seeding)
20. [DNS Configuration (Optional Custom Domain)](#20-dns-configuration-optional-custom-domain)
21. [Validation Checklist](#21-validation-checklist)
22. [Environment Variables Reference](#22-environment-variables-reference)
23. [Operational Notes](#23-operational-notes)

---

## 1. Prerequisites

### Tools Required

| Tool | Version | Purpose |
|------|---------|---------|
| Azure CLI (`az`) | ≥ 2.60 | All infrastructure provisioning |
| Docker (or Podman) | Any recent | Local testing only (ACR builds remotely) |
| Node.js | ≥ 20 | Frontend build (local dev) |
| Python | ≥ 3.11 | Backend runtime |
| `openssl` | Any | TLS certificate generation |
| `psql` | ≥ 16 | Database admin (optional) |

### Azure Permissions Required

- **Subscription-level**: Contributor role (or Owner for RBAC assignments)
- **Azure AD**: Ability to create App Registrations (for AAD-based Speech auth, if used)
- **Resource providers** that must be registered:
  ```bash
  az provider register -n Microsoft.App
  az provider register -n Microsoft.ContainerRegistry
  az provider register -n Microsoft.DBforPostgreSQL
  az provider register -n Microsoft.CognitiveServices
  az provider register -n Microsoft.Network
  az provider register -n Microsoft.KeyVault
  az provider register -n Microsoft.OperationalInsights
  ```

### Information Needed Before Starting

- **Subscription ID** — target Azure subscription
- **Region** — e.g., `centralus` (must support all services listed)
- **UAIS/HCP credentials** (for UHG AI Gateway access):
  - `UAIS_TOKEN_URL`, `HCP_CLIENT_ID`, `HCP_CLIENT_SECRETE`, `HCP_SCOPE`
  - `UAIS_COMPLETIONS_ENDPOINT`, `UAIS_DEPLOYMENT`, `UAIS_WHISPER_DEPLOYMENT`, `UAIS_PROJECT_ID`
- **Corporate proxy / Zscaler IP ranges** (for Speech Service IP allowlist)

---

## 2. Architecture Overview

```
                         ┌──────────────────────────────┐
                         │      Public Internet         │
                         └──────────┬───────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  Application        │
                          │  Gateway (v2)       │
                          │  pip: Public IP     │
                          │  snet-appgw         │
                          └──┬──────────┬───────┘
                             │          │
                    /api/*   │          │  /* (default)
                             │          │
              ┌──────────────▼──┐  ┌───▼──────────────┐
              │   pvs-api       │  │   pvs-web         │
              │   (FastAPI)     │  │   (nginx + Vite)  │
              │   Port 8000     │  │   Port 8080       │
              │   0.5 vCPU/1Gi  │  │   0.25 vCPU/0.5Gi│
              └──────┬──────────┘  └───────────────────┘
                     │                     ▲
        ┌────────────┼───────────────────────────────────┐
        │  Container Apps Environment (internal VNet)    │
        │  snet-cae (10.40.0.0/23)                       │
        │  Static IP: 10.40.0.67                         │
        └────────────┼───────────────────────────────────┘
                     │
        ┌────────────▼───────────────────────────────────┐
        │  snet-pe (10.40.2.0/24) — Private Endpoints    │
        │                                                │
        │  ┌─────────────┐    ┌───────────────────────┐  │
        │  │ PostgreSQL   │    │ Azure Speech Service  │  │
        │  │ PE: 10.40.2.4│    │ PE: 10.40.2.6        │  │
        │  └─────────────┘    └───────────────────────┘  │
        └────────────────────────────────────────────────┘
```

### Resource Summary

| Resource | Type | SKU | Purpose |
|----------|------|-----|---------|
| Resource Group | `Microsoft.Resources/resourceGroups` | — | Logical container |
| VNet | `Microsoft.Network/virtualNetworks` | — | Network isolation |
| Log Analytics | `Microsoft.OperationalInsights/workspaces` | PerGB2018 | Container logging |
| ACR | `Microsoft.ContainerRegistry/registries` | Basic | Container image registry |
| PostgreSQL | `Microsoft.DBforPostgreSQL/flexibleServers` | Standard_B1ms (Burstable) | Application database |
| PE (PostgreSQL) | `Microsoft.Network/privateEndpoints` | — | Private DB access |
| Speech Service | `Microsoft.CognitiveServices/accounts` | S0 | Audio transcription |
| PE (Speech) | `Microsoft.Network/privateEndpoints` | — | Private speech access |
| Key Vault | `Microsoft.KeyVault/vaults` | Standard | Secret management |
| Container Apps Env | `Microsoft.App/managedEnvironments` | Consumption | Container runtime |
| pvs-api | `Microsoft.App/containerApps` | 0.5 CPU / 1Gi | Backend API |
| pvs-web | `Microsoft.App/containerApps` | 0.25 CPU / 0.5Gi | Frontend SPA |
| Public IP | `Microsoft.Network/publicIPAddresses` | Standard | AppGW frontend |
| Application Gateway | `Microsoft.Network/applicationGateways` | Standard_v2 | Reverse proxy / LB |
| Private DNS Zones (×3) | `Microsoft.Network/privateDnsZones` | — | PE name resolution |

---

## 3. Variable Reference

Set these shell variables before running commands. Replace placeholder values with your actuals.

```bash
# ── Subscription & Location ──────────────────────────────────────────────
export SUB_ID="<your-subscription-id>"
export LOCATION="centralus"
export RG="rg-pvs-demo"

# ── Naming (use a random suffix to ensure global uniqueness) ─────────────
SUFFIX=$(openssl rand -hex 3)   # e.g., "s3lshj"
export ACR_NAME="acrpvsdemo${SUFFIX}"          # must be alphanumeric, globally unique
export PG_SERVER="pg-pvs-demo-${SUFFIX}"       # globally unique
export KV_NAME="kv-pvs-demo-${SUFFIX}"         # globally unique
export SPEECH_NAME="speech-pvs-demo"           # custom domain name for speech
export VNET_NAME="vnet-pvs-demo"
export CAE_NAME="cae-pvs-demo"
export LAW_NAME="law-pvs-demo"
export PIP_NAME="pip-appgw-pvs"
export APPGW_NAME="appgw-pvs-demo"

# ── Network Ranges ───────────────────────────────────────────────────────
export VNET_CIDR="10.40.0.0/16"
export SNET_CAE_CIDR="10.40.0.0/23"            # /23 minimum for Container Apps
export SNET_PE_CIDR="10.40.2.0/24"
export SNET_APPGW_CIDR="10.40.3.0/24"

# ── Database ─────────────────────────────────────────────────────────────
export PG_ADMIN_USER="pvsadmin"
export PG_ADMIN_PASS="$(openssl rand -base64 24)"  # save this securely
export PG_DB_NAME="pvs"

# ── Login ────────────────────────────────────────────────────────────────
az login
az account set --subscription "$SUB_ID"
```

> **Important**: Save `PG_ADMIN_PASS` and `SUFFIX` immediately — you will need them later.

---

## 4. Resource Group

```bash
az group create \
  --name "$RG" \
  --location "$LOCATION" \
  -o none
```

---

## 5. Virtual Network (VNet)

Create the VNet with three subnets:

| Subnet | CIDR | Purpose | Delegation |
|--------|------|---------|------------|
| `snet-cae` | 10.40.0.0/23 | Container Apps Environment | `Microsoft.App/environments` |
| `snet-pe` | 10.40.2.0/24 | Private Endpoints (PG, Speech) | None |
| `snet-appgw` | 10.40.3.0/24 | Application Gateway | None |

```bash
# Create VNet
az network vnet create \
  --resource-group "$RG" \
  --name "$VNET_NAME" \
  --address-prefix "$VNET_CIDR" \
  --location "$LOCATION" \
  -o none

# Subnet for Container Apps (requires /23 min, delegation to Microsoft.App)
az network vnet subnet create \
  --resource-group "$RG" \
  --vnet-name "$VNET_NAME" \
  --name snet-cae \
  --address-prefix "$SNET_CAE_CIDR" \
  --delegations Microsoft.App/environments \
  -o none

# Subnet for Private Endpoints
az network vnet subnet create \
  --resource-group "$RG" \
  --vnet-name "$VNET_NAME" \
  --name snet-pe \
  --address-prefix "$SNET_PE_CIDR" \
  -o none

# Subnet for Application Gateway
az network vnet subnet create \
  --resource-group "$RG" \
  --vnet-name "$VNET_NAME" \
  --name snet-appgw \
  --address-prefix "$SNET_APPGW_CIDR" \
  -o none

# Enable Microsoft.CognitiveServices service endpoint on CAE subnet
# (needed for Speech Service VNet rules)
az network vnet subnet update \
  --resource-group "$RG" \
  --vnet-name "$VNET_NAME" \
  --name snet-cae \
  --service-endpoints Microsoft.CognitiveServices \
  -o none
```

---

## 6. Log Analytics Workspace

Required by the Container Apps Environment for log ingestion.

```bash
az monitor log-analytics workspace create \
  --resource-group "$RG" \
  --workspace-name "$LAW_NAME" \
  --location "$LOCATION" \
  --retention-time 30 \
  --sku PerGB2018 \
  -o none

# Retrieve the workspace ID and key for Container Apps
LAW_ID=$(az monitor log-analytics workspace show \
  -g "$RG" -n "$LAW_NAME" \
  --query customerId -o tsv)

LAW_KEY=$(az monitor log-analytics workspace get-shared-keys \
  -g "$RG" -n "$LAW_NAME" \
  --query primarySharedKey -o tsv)
```

---

## 7. Azure Container Registry (ACR)

```bash
az acr create \
  --resource-group "$RG" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true \
  --location "$LOCATION" \
  -o none

# Get ACR credentials (used by Container Apps)
ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"
ACR_PASSWORD=$(az acr credential show -n "$ACR_NAME" --query "passwords[0].value" -o tsv)
```

---

## 8. PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --location "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_ADMIN_PASS" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --public-access 0.0.0.0 \
  --yes \
  -o none

# Create the application database
az postgres flexible-server db create \
  --resource-group "$RG" \
  --server-name "$PG_SERVER" \
  --database-name "$PG_DB_NAME" \
  -o none
```

> **Note**: `--public-access 0.0.0.0` initially allows public access so you can configure it. After the private endpoint is set up, you can disable public access if desired.

### 8b. PostgreSQL Firewall Rules for Container Apps

> **Important — UHG Policy Note**: The `AllowAllAzureServicesAndResourcesWithinAzureIps` rule (start/end IP `0.0.0.0`) is blocked by UHG policy `AzureFlexiblePostgreSQLServerPublicAccessDryRun`. You must add explicit firewall rules for the Container Apps outbound IPs instead.

Container Apps in an internal VNet environment use a large pool of shared outbound IP addresses. After creating the Container App (Section 14), retrieve and whitelist these IPs:

```bash
# Get all outbound IPs for the container app
OUTBOUND_IPS=$(az containerapp show -g "$RG" -n pvs-api \
  --query 'properties.outboundIpAddresses' -o tsv)

echo "Outbound IPs: $OUTBOUND_IPS"
```

Rather than adding 100+ individual IPs, add broad CIDR-range rules covering the major Azure IP blocks. Inspect the outbound IPs and create rules for each /8 or /16 prefix:

```bash
# Example broad ranges (adjust based on actual outbound IPs in your region)
# Each rule takes ~2-3 minutes to provision.
for RANGE in \
  "20.0.0.0 20.255.255.255 azure-range-20" \
  "172.168.0.0 172.171.255.255 azure-range-172" \
  "104.0.0.0 104.255.255.255 azure-range-104" \
  "40.0.0.0 40.255.255.255 azure-range-40" \
  "52.0.0.0 52.255.255.255 azure-range-52" \
  "135.233.0.0 135.233.255.255 azure-range-135" \
  "64.236.0.0 64.236.255.255 azure-range-64" \
  "128.203.0.0 128.203.255.255 azure-range-128" \
  "72.152.0.0 72.152.255.255 azure-range-72" \
  "48.214.0.0 48.214.255.255 azure-range-48" \
  "13.89.0.0 13.89.255.255 azure-range-13" \
  "130.131.0.0 130.131.255.255 azure-range-130" \
  "132.196.0.0 132.196.255.255 azure-range-132" \
  "9.234.0.0 9.234.255.255 azure-range-9" \
  "4.249.0.0 4.249.255.255 azure-range-4"; do
  START=$(echo $RANGE | cut -d' ' -f1)
  END=$(echo $RANGE | cut -d' ' -f2)
  NAME=$(echo $RANGE | cut -d' ' -f3)
  az postgres flexible-server firewall-rule create \
    -g "$RG" -n "$PG_SERVER" \
    --rule-name "$NAME" \
    --start-ip-address "$START" \
    --end-ip-address "$END" \
    -o none && echo "Done: $NAME" || echo "Failed: $NAME"
done
```

> **Tip**: Run these firewall rules **before** creating the container app, or the app will get stuck in "Activating" state while it can't reach the database.

### Build the DATABASE_URL

```bash
export DATABASE_URL="postgresql+asyncpg://${PG_ADMIN_USER}:${PG_ADMIN_PASS}@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB_NAME}?ssl=require"
```

---

## 9. Private Endpoint — PostgreSQL

### 9a. Create the Private Endpoint

```bash
PG_RESOURCE_ID=$(az postgres flexible-server show \
  -g "$RG" -n "$PG_SERVER" --query id -o tsv)

az network private-endpoint create \
  --resource-group "$RG" \
  --name "pe-pg-${PG_SERVER}" \
  --vnet-name "$VNET_NAME" \
  --subnet snet-pe \
  --private-connection-resource-id "$PG_RESOURCE_ID" \
  --group-id postgresqlServer \
  --connection-name "pg-pe-conn" \
  --location "$LOCATION" \
  -o none
```

### 9b. Create Private DNS Zone for PostgreSQL

```bash
az network private-dns zone create \
  --resource-group "$RG" \
  --name "privatelink.postgres.database.azure.com" \
  -o none

# Link DNS zone to VNet
az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name "privatelink.postgres.database.azure.com" \
  --name "pg-vnet-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  -o none

# Create DNS record pointing to PE's private IP
PE_PG_IP=$(az network private-endpoint show \
  -g "$RG" -n "pe-pg-${PG_SERVER}" \
  --query "customDnsConfigs[0].ipAddresses[0]" -o tsv)

az network private-dns record-set a create \
  --resource-group "$RG" \
  --zone-name "privatelink.postgres.database.azure.com" \
  --name "$PG_SERVER" \
  -o none

az network private-dns record-set a add-record \
  --resource-group "$RG" \
  --zone-name "privatelink.postgres.database.azure.com" \
  --record-set-name "$PG_SERVER" \
  --ipv4-address "$PE_PG_IP" \
  -o none
```

---

## 10. Azure Speech Service

### 10a. Create the Speech Service

> **UHG Policy Constraint**: The `az cognitiveservices account create` CLI command does **not** support setting `publicNetworkAccess: Disabled` or `networkAcls.defaultAction: Deny` at creation time. UHG policy `PCG-51003` ("AI Services should restrict overly permissive public network access") will **deny** any Cognitive Services resource created without these properties. You **must** use the ARM REST API directly.

```bash
# Use az rest to create with restricted network access in a single atomic operation
az rest --method PUT \
  --url "https://management.azure.com/subscriptions/${SUB_ID}/resourceGroups/${RG}/providers/Microsoft.CognitiveServices/accounts/${SPEECH_NAME}?api-version=2023-10-01-preview" \
  --body "{
    \"location\": \"${LOCATION}\",
    \"kind\": \"SpeechServices\",
    \"sku\": {\"name\": \"S0\"},
    \"properties\": {
      \"customSubDomainName\": \"${SPEECH_NAME}\",
      \"publicNetworkAccess\": \"Disabled\",
      \"networkAcls\": {\"defaultAction\": \"Deny\"}
    }
  }" \
  --query 'properties.provisioningState' -o tsv
```

> **Why not `az cognitiveservices account create`?** The CLI creates the resource first with `publicNetworkAccess: Enabled` and `defaultAction: Allow`, then applies updates. The initial creation triggers a policy deny before the update can run. The REST API sets all properties atomically in a single PUT.

> **Custom subdomain note**: The `customSubDomainName` creates a custom subdomain (e.g., `speech-pvs-demo.cognitiveservices.azure.com`). This is **required** for private endpoint support. If you get a `CustomDomainInUse` error, choose a unique name (e.g., append a random suffix).

### 10b. Verify Network Restrictions

Since the resource was created with `publicNetworkAccess: Disabled` and `networkAcls.defaultAction: Deny`, no additional network configuration is needed — all access must go through the private endpoint (Section 11).

```bash
# Verify the Speech Service was created with correct network settings
az cognitiveservices account show -g "$RG" -n "$SPEECH_NAME" \
  --query '{publicAccess:properties.publicNetworkAccess, defaultAction:properties.networkAcls.defaultAction}' -o json
# Expected: {"publicAccess": "Disabled", "defaultAction": "Deny"}
```

### 10c. Retrieve Speech Key and Endpoint

```bash
SPEECH_KEY=$(az cognitiveservices account keys list \
  -g "$RG" -n "$SPEECH_NAME" --query key1 -o tsv)

SPEECH_ENDPOINT=$(az cognitiveservices account show \
  -g "$RG" -n "$SPEECH_NAME" --query properties.endpoint -o tsv)

echo "Speech Key: $SPEECH_KEY"
echo "Speech Endpoint: $SPEECH_ENDPOINT"
```

---

## 11. Private Endpoint — Speech Service

### 11a. Create the Private Endpoint

```bash
SPEECH_RESOURCE_ID=$(az cognitiveservices account show \
  -g "$RG" -n "$SPEECH_NAME" --query id -o tsv)

az network private-endpoint create \
  --resource-group "$RG" \
  --name "pe-speech-pvs" \
  --vnet-name "$VNET_NAME" \
  --subnet snet-pe \
  --private-connection-resource-id "$SPEECH_RESOURCE_ID" \
  --group-id account \
  --connection-name "speech-pe-conn" \
  --location "$LOCATION" \
  -o none
```

### 11b. Create Private DNS Zone for Cognitive Services

```bash
az network private-dns zone create \
  --resource-group "$RG" \
  --name "privatelink.cognitiveservices.azure.com" \
  -o none

az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name "privatelink.cognitiveservices.azure.com" \
  --name "speech-vnet-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  -o none
```

### 11c. Get Private Endpoint IP and Create DNS Record

> **Lesson learned**: The `customDnsConfigs[0].ipAddresses[0]` JMESPath query can return empty for some PE types. Retrieve the IP from the NIC's `ipConfigurations` instead. Note the property name is `privateIPAddress` (camelCase with capital **A**), not `privateIpAddress`.

```bash
# Get the NIC resource ID from the private endpoint
PE_NIC_ID=$(az network private-endpoint show \
  -g "$RG" -n "pe-speech-pvs" \
  --query 'networkInterfaces[0].id' -o tsv)

# Get the private IP from the NIC (note: privateIPAddress, not privateIpAddress)
PE_SPEECH_IP=$(az network nic show --ids "$PE_NIC_ID" \
  --query 'ipConfigurations[0].privateIPAddress' -o tsv)

echo "Speech PE IP: $PE_SPEECH_IP"  # e.g., 10.40.2.4

# Create the DNS A record (add-record auto-creates the record set)
az network private-dns record-set a add-record \
  --resource-group "$RG" \
  --zone-name "privatelink.cognitiveservices.azure.com" \
  --record-set-name "$SPEECH_NAME" \
  --ipv4-address "$PE_SPEECH_IP" \
  -o none
```

---

## 12. Key Vault

```bash
az keyvault create \
  --resource-group "$RG" \
  --name "$KV_NAME" \
  --location "$LOCATION" \
  --sku standard \
  --enable-rbac-authorization true \
  --default-action Deny \
  -o none
```

> The Key Vault is provisioned with RBAC mode and firewall deny-by-default. Secrets are passed directly as Container App env vars rather than via Key Vault references.

> **Warning — Key Vault + Container Apps Secret References**:
> Do **NOT** use Container Apps KV secret references (`keyVaultUrl` + `identity: system`) with a firewall-enabled Key Vault in UHG subscriptions. This combination fails because:
> 1. UHG policy **blocks** setting `defaultAction: Allow` on Key Vault (`AzureKeyVaultShouldHaveFirewallEnabled`).
> 2. Container Apps in a delegated subnet (`Microsoft.App/environments`) **cannot** have a `Microsoft.KeyVault` service endpoint added — the delegation blocks it.
> 3. The `bypass: AzureServices` flag does **not** cover Container Apps managed identity secret resolution.
> 4. If any KV-backed secret definition exists on the container app (even if env vars no longer reference it), the runtime still tries to resolve it, causing the revision to get stuck in **"Activating"** indefinitely.
>
> **Solution**: Pass all secrets as direct env vars using `--env-vars` or `--secrets "name=value"` on `az containerapp create`. See Section 14b.

---

## 13. Container Apps Environment

### 13a. Create the Internal Environment

```bash
SNET_CAE_ID=$(az network vnet subnet show \
  -g "$RG" --vnet-name "$VNET_NAME" -n snet-cae \
  --query id -o tsv)

az containerapp env create \
  --resource-group "$RG" \
  --name "$CAE_NAME" \
  --location "$LOCATION" \
  --logs-workspace-id "$LAW_ID" \
  --logs-workspace-key "$LAW_KEY" \
  --infrastructure-subnet-resource-id "$SNET_CAE_ID" \
  --internal-only true \
  -o none
```

> **`--internal-only true`** means the Container Apps are only reachable within the VNet. External traffic is routed through the Application Gateway.

### 13b. Get the Environment's Static IP and Default Domain

```bash
CAE_STATIC_IP=$(az containerapp env show \
  -g "$RG" -n "$CAE_NAME" \
  --query properties.staticIp -o tsv)

CAE_DOMAIN=$(az containerapp env show \
  -g "$RG" -n "$CAE_NAME" \
  --query properties.defaultDomain -o tsv)

echo "CAE Static IP: $CAE_STATIC_IP"     # e.g., 10.40.0.67
echo "CAE Domain: $CAE_DOMAIN"           # e.g., yellowbeach-ee06f0d4.centralus.azurecontainerapps.io
```

### 13c. Create Private DNS Zone for Container Apps

The Application Gateway needs to resolve `pvs-api.<domain>` and `pvs-web.<domain>` to the internal IP.

```bash
az network private-dns zone create \
  --resource-group "$RG" \
  --name "$CAE_DOMAIN" \
  -o none

az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name "$CAE_DOMAIN" \
  --name "cae-vnet-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  -o none

# Wildcard A record — all apps in the environment resolve to the static IP
az network private-dns record-set a create \
  --resource-group "$RG" \
  --zone-name "$CAE_DOMAIN" \
  --name "*" \
  -o none

az network private-dns record-set a add-record \
  --resource-group "$RG" \
  --zone-name "$CAE_DOMAIN" \
  --record-set-name "*" \
  --ipv4-address "$CAE_STATIC_IP" \
  -o none

# Apex record
az network private-dns record-set a create \
  --resource-group "$RG" \
  --zone-name "$CAE_DOMAIN" \
  --name "@" \
  -o none

az network private-dns record-set a add-record \
  --resource-group "$RG" \
  --zone-name "$CAE_DOMAIN" \
  --record-set-name "@" \
  --ipv4-address "$CAE_STATIC_IP" \
  -o none
```

---

## 14. Build & Deploy — Backend (pvs-api)

### 14a. Build the Container Image via ACR

```bash
# From the repository root
az acr build \
  --registry "$ACR_NAME" \
  --image pvs-api:v1 \
  --file backend/Dockerfile \
  backend/
```

### 14b. Create the Container App

```bash
az containerapp create \
  --resource-group "$RG" \
  --name pvs-api \
  --environment "$CAE_NAME" \
  --image "${ACR_LOGIN_SERVER}/pvs-api:v1" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --target-port 8000 \
  --ingress external \
  --transport auto \
  --cpu 0.5 \
  --memory 1Gi \
  --min-replicas 1 \
  --max-replicas 3 \
  --secrets \
    "database-url=$DATABASE_URL" \
    "hcp-client-secrete=<YOUR_HCP_CLIENT_SECRET>" \
    "speech-client-secret=<YOUR_SPEECH_CLIENT_SECRET_IF_USING_AAD>" \
  --env-vars \
    "APP_ENV=prod" \
    "DATABASE_URL=secretref:database-url" \
    "API_CORS_ORIGINS=https://<YOUR_DOMAIN>,http://<YOUR_PUBLIC_IP>,http://localhost:5173" \
    "UAIS_TOKEN_URL=<YOUR_UAIS_TOKEN_URL>" \
    "UAIS_COMPLETIONS_ENDPOINT=<YOUR_UAIS_COMPLETIONS_ENDPOINT>" \
    "UAIS_API_VERSION=2025-01-01-preview" \
    "UAIS_DEPLOYMENT=<YOUR_DEPLOYMENT_NAME>" \
    "UAIS_WHISPER_DEPLOYMENT=whisper" \
    "UAIS_PROJECT_ID=<YOUR_PROJECT_ID>" \
    "HCP_CLIENT_ID=<YOUR_HCP_CLIENT_ID>" \
    "HCP_CLIENT_SECRETE=secretref:hcp-client-secrete" \
    "HCP_SCOPE=https://api.uhg.com/.default" \
    "AZURE_SPEECH_KEY=$SPEECH_KEY" \
    "AZURE_SPEECH_REGION=$LOCATION" \
    "AZURE_SPEECH_ENDPOINT=$SPEECH_ENDPOINT" \
  -o none
```

> **Notes**:
> - Replace all `<YOUR_...>` placeholders with actual values.
> - The `transport auto` setting enables WebSocket support (needed for live transcription proxy).
> - If using AAD-based speech auth instead of key, add: `AZURE_SPEECH_CLIENT_ID`, `AZURE_SPEECH_CLIENT_SECRET` (secretref), `AZURE_SPEECH_TENANT_ID`, `AZURE_SPEECH_RESOURCE_ID`.

### 14c. Update the Backend (subsequent deploys)

```bash
# Build new image
az acr build --registry "$ACR_NAME" --image pvs-api:v2 --file backend/Dockerfile backend/

# Update the container app
az containerapp update -n pvs-api -g "$RG" --image "${ACR_LOGIN_SERVER}/pvs-api:v2"
```

---

## 15. Build & Deploy — Frontend (pvs-web)

### 15a. Build the Container Image

```bash
# VITE_API_BASE_URL="" makes the frontend use relative URLs
# (since AppGW routes /api/* to the backend)
az acr build \
  --registry "$ACR_NAME" \
  --image pvs-web:v1 \
  --build-arg VITE_API_BASE_URL="" \
  --file web/Dockerfile.prod \
  web/
```

### 15b. Create the Container App

```bash
az containerapp create \
  --resource-group "$RG" \
  --name pvs-web \
  --environment "$CAE_NAME" \
  --image "${ACR_LOGIN_SERVER}/pvs-web:v1" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --target-port 8080 \
  --ingress external \
  --transport auto \
  --cpu 0.25 \
  --memory 0.5Gi \
  --min-replicas 1 \
  --max-replicas 2 \
  -o none
```

### 15c. Update the Frontend (subsequent deploys)

```bash
az acr build --registry "$ACR_NAME" --image pvs-web:v2 --build-arg VITE_API_BASE_URL="" --file web/Dockerfile.prod web/
az containerapp update -n pvs-web -g "$RG" --image "${ACR_LOGIN_SERVER}/pvs-web:v2"
```

---

## 16. Application Gateway

The Application Gateway acts as the public entry point, routing traffic to the internal Container Apps.

### 16a. Create a Public IP

```bash
az network public-ip create \
  --resource-group "$RG" \
  --name "$PIP_NAME" \
  --sku Standard \
  --allocation-method Static \
  --location "$LOCATION" \
  -o none

PUBLIC_IP=$(az network public-ip show -g "$RG" -n "$PIP_NAME" --query ipAddress -o tsv)
echo "Public IP: $PUBLIC_IP"
```

### 16b. Get Container App FQDNs

```bash
API_FQDN=$(az containerapp show -g "$RG" -n pvs-api --query properties.configuration.ingress.fqdn -o tsv)
WEB_FQDN=$(az containerapp show -g "$RG" -n pvs-web --query properties.configuration.ingress.fqdn -o tsv)
echo "API FQDN: $API_FQDN"
echo "WEB FQDN: $WEB_FQDN"
```

### 16c. Create the Application Gateway

```bash
az network application-gateway create \
  --resource-group "$RG" \
  --name "$APPGW_NAME" \
  --location "$LOCATION" \
  --sku Standard_v2 \
  --capacity 1 \
  --vnet-name "$VNET_NAME" \
  --subnet snet-appgw \
  --public-ip-address "$PIP_NAME" \
  --frontend-port 80 \
  --http-settings-port 443 \
  --http-settings-protocol Https \
  --servers "$CAE_STATIC_IP" \
  --priority 100 \
  -o none
```

### 16d. Configure Backend HTTP Settings

The AppGW communicates with Container Apps over HTTPS (they enforce TLS). The `--host-name` must match the Container App FQDN so the correct certificate is presented.

```bash
# Settings for frontend (pvs-web)
az network application-gateway http-settings update \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name appGatewayBackendHttpSettings \
  --host-name "$WEB_FQDN" \
  --protocol Https \
  --port 443 \
  --timeout 120 \
  -o none

# Settings for API (pvs-api)
az network application-gateway http-settings create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name apiHttpSettings \
  --host-name "$API_FQDN" \
  --protocol Https \
  --port 443 \
  --timeout 180 \
  -o none
```

### 16e. Create Backend Pools

```bash
# Default pool (frontend) — already created by gateway create, update its address
az network application-gateway address-pool update \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name appGatewayBackendPool \
  --servers "$CAE_STATIC_IP" \
  -o none

# API pool
az network application-gateway address-pool create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name apiBackendPool \
  --servers "$CAE_STATIC_IP" \
  -o none
```

### 16f. Create Health Probes

```bash
az network application-gateway probe create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name webProbe \
  --protocol Https \
  --host "$WEB_FQDN" \
  --path "/" \
  --interval 30 \
  --timeout 30 \
  --threshold 3 \
  -o none

az network application-gateway probe create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name apiProbe \
  --protocol Https \
  --host "$API_FQDN" \
  --path "/api/health" \
  --interval 30 \
  --timeout 30 \
  --threshold 3 \
  -o none

# Attach probes to HTTP settings
az network application-gateway http-settings update \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name appGatewayBackendHttpSettings \
  --probe webProbe \
  -o none

az network application-gateway http-settings update \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name apiHttpSettings \
  --probe apiProbe \
  -o none
```

### 16g. Create URL Path-Based Routing

```bash
# Delete the default basic routing rule (we'll replace with path-based)
az network application-gateway rule delete \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name rule1 \
  -o none 2>/dev/null || true

# Create URL path map: /api/* → apiBackendPool, default → appGatewayBackendPool
az network application-gateway url-path-map create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name urlPathMap \
  --default-backend-pool appGatewayBackendPool \
  --default-http-settings appGatewayBackendHttpSettings \
  --paths "/api/*" \
  --address-pool apiBackendPool \
  --http-settings apiHttpSettings \
  --rule-name apiRule \
  -o none

# Create the routing rule
az network application-gateway rule create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name rule1 \
  --http-listener appGatewayHttpListener \
  --rule-type PathBasedRouting \
  --url-path-map urlPathMap \
  --address-pool appGatewayBackendPool \
  --http-settings appGatewayBackendHttpSettings \
  --priority 100 \
  -o none
```

---

## 17. TLS / HTTPS Configuration

HTTPS is **required** for browser microphone access (`navigator.mediaDevices`). Without HTTPS, the browser will block the "Live Transcript" feature entirely. For production, use a real domain and certificate. For demos, a self-signed certificate works (users must accept the browser warning).

### 17a. Generate a Self-Signed Certificate (Demo)

> **Shell warning**: Do **not** use `!` in the certificate password — zsh interprets `!` inside double quotes as history expansion, which causes the terminal to hang in `dquote>` state. Use alphanumeric passwords only.

```bash
CERT_DOMAIN="${PUBLIC_IP//./-}.nip.io"   # e.g., 52-176-18-179.nip.io
CERT_PASS="YourCertPassword123"          # No special chars like ! (breaks zsh)

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/pvs.key \
  -out /tmp/pvs.crt \
  -subj "/CN=${CERT_DOMAIN}" \
  -addext "subjectAltName=DNS:${CERT_DOMAIN},IP:${PUBLIC_IP}"

openssl pkcs12 -export \
  -out /tmp/pvs-selfsigned.pfx \
  -inkey /tmp/pvs.key \
  -in /tmp/pvs.crt \
  -password "pass:${CERT_PASS}"
```

### 17b. For Production: Use a Trusted Certificate

For a browser-trusted URL with no security warnings, use Let's Encrypt (free, automated). See **§18 — Trusted TLS with Let's Encrypt** for the full procedure.

Alternatively, obtain a cert from DigiCert or your organization's CA and export it as `.pfx`.

### 17c. Upload Certificate and Create HTTPS Listener

> **Lesson learned**: The `--frontend-ip` value must match the actual frontend IP configuration name on your AppGW. Run `az network application-gateway frontend-ip list --gateway-name $APPGW_NAME -g $RG --query '[].name' -o tsv` to find it — it's usually `appGatewayFrontendIP` (not `appGwPublicFrontendIp`).

```bash
# Upload the certificate
az network application-gateway ssl-cert create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name pvs-ssl-cert \
  --cert-file /tmp/pvs-selfsigned.pfx \
  --cert-password "$CERT_PASS" \
  -o none

# Create HTTPS frontend port
az network application-gateway frontend-port create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name httpsPort \
  --port 443 \
  -o none

# Find the actual frontend IP config name (usually appGatewayFrontendIP)
FRONTEND_IP=$(az network application-gateway frontend-ip list \
  --gateway-name "$APPGW_NAME" -g "$RG" --query '[0].name' -o tsv)

# Create HTTPS listener
az network application-gateway http-listener create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name httpsListener \
  --frontend-port httpsPort \
  --ssl-cert pvs-ssl-cert \
  --frontend-ip "$FRONTEND_IP" \
  -o none

# Create URL path map for HTTPS
# IMPORTANT: Use --default-address-pool and --default-http-settings
# (not --default-backend-pool / --default-backend-http-settings — those don't exist)
# IMPORTANT: The API path rule must use apiHttpSettings (with the correct backend hostname),
# not appGatewayBackendHttpSettings (which routes to the frontend)
az network application-gateway url-path-map create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name urlPathMapHttps \
  --default-address-pool appGatewayBackendPool \
  --default-http-settings appGatewayBackendHttpSettings \
  --paths "/api/*" \
  --address-pool apiBackendPool \
  --http-settings apiHttpSettings \
  --rule-name apiRuleHttps \
  -o none

# Create HTTPS routing rule
# Note: --address-pool and --http-settings are required when multiple backend pools exist
az network application-gateway rule create \
  --resource-group "$RG" \
  --gateway-name "$APPGW_NAME" \
  --name ruleHttps \
  --http-listener httpsListener \
  --rule-type PathBasedRouting \
  --url-path-map urlPathMapHttps \
  --address-pool appGatewayBackendPool \
  --http-settings appGatewayBackendHttpSettings \
  --priority 200 \
  -o none
```

> **If `/api/*` returns the frontend HTML over HTTPS**: The URL path map's API rule is using the wrong HTTP settings. The `apiHttpSettings` routes to `pvs-api.<cae-domain>`, while `appGatewayBackendHttpSettings` routes to `pvs-web.<cae-domain>`. Delete and recreate the URL path map with `--http-settings apiHttpSettings` for the API rule.

---

## 18. Trusted TLS with Let's Encrypt

This section replaces the self-signed certificate from §17a with a **free, browser-trusted** Let's Encrypt certificate. After completing these steps, users will not see any "untrusted website" warnings.

> **Why this approach?** Corporate environments (Zscaler, etc.) block certbot from running locally because HTTPS interception breaks the ACME client's TLS to `acme-v02.api.letsencrypt.org`. Running certbot inside a **Container Apps Job** bypasses this — Container Apps have direct internet access without proxy interference.

### 18a. Add Temporary ACME Endpoints to the Backend

Let's Encrypt validates domain ownership by requesting a token at `http://<domain>/.well-known/acme-challenge/<token>`. We add temporary endpoints to the backend to serve these challenge responses.

Add the following to `backend/app/main.py` (after the router includes, before the `/api/health` endpoint):

```python
import os as _os
from fastapi.requests import Request as _Request

_acme_challenges: dict[str, str] = {}
_acme_certs: dict[str, str] = {}

@app.get("/.well-known/acme-challenge/{token}")
async def acme_challenge(token: str):
    from fastapi.responses import PlainTextResponse
    from fastapi import HTTPException
    if token in _acme_challenges:
        return PlainTextResponse(_acme_challenges[token])
    raise HTTPException(404, "Challenge not found")

@app.get("/api/acme/set")
async def set_acme_challenge(token: str, response: str):
    from fastapi.responses import PlainTextResponse
    _acme_challenges[token] = response
    return PlainTextResponse(f"Set challenge for {token}")

@app.post("/api/acme/cert")
async def store_acme_cert(request: _Request):
    from fastapi.responses import PlainTextResponse
    body = await request.body()
    cert_type = request.headers.get("x-cert-type", "unknown")
    _acme_certs[cert_type] = body.decode("utf-8")
    return PlainTextResponse(f"Stored {cert_type} ({len(body)} bytes)")

@app.get("/api/acme/cert/{cert_type}")
async def get_acme_cert(cert_type: str):
    from fastapi.responses import PlainTextResponse
    from fastapi import HTTPException
    if cert_type not in _acme_certs:
        raise HTTPException(404, f"No cert data for {cert_type}")
    return PlainTextResponse(_acme_certs[cert_type])
```

Build and deploy:

```bash
az acr build --registry "$ACR_NAME" --image "pvs-api:acme" \
  --file backend/Dockerfile backend/ \
  --build-arg "CACHE_BUST=$(date +%s)" -o none

az containerapp update -g "$RG" -n pvs-api \
  --image "${ACR_NAME}.azurecr.io/pvs-api:acme"
```

### 18b. Add ACME Path Rules to Application Gateway

The ACME challenge path must be routed to the API backend on **both** HTTP and HTTPS URL path maps:

```bash
# HTTP path map
az network application-gateway url-path-map rule create \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  --path-map-name urlPathMap \
  -n acmeRule \
  --paths "/.well-known/acme-challenge/*" \
  --address-pool apiBackendPool \
  --http-settings apiHttpSettings \
  -o none

# HTTPS path map
az network application-gateway url-path-map rule create \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  --path-map-name urlPathMapHttps \
  -n acmeRuleHttps \
  --paths "/.well-known/acme-challenge/*" \
  --address-pool apiBackendPool \
  --http-settings apiHttpSettings \
  -o none
```

Verify the endpoints work:

```bash
curl -sk "https://${CERT_DOMAIN}/api/acme/set?token=test&response=test123"
# Expected: Set challenge for test

curl -sk "https://${CERT_DOMAIN}/.well-known/acme-challenge/test"
# Expected: test123
```

### 18c. Build the Certbot Runner Image

Create three files in a temp directory:

**Dockerfile:**
```dockerfile
FROM certbot/certbot:latest
RUN apk add --no-cache curl
COPY auth-hook.sh /usr/local/bin/auth-hook.sh
RUN chmod +x /usr/local/bin/auth-hook.sh
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/run.sh"]
```

**auth-hook.sh** (called by certbot with `$CERTBOT_TOKEN` and `$CERTBOT_VALIDATION`):
```bash
#!/bin/sh
curl -s "http://${CERT_DOMAIN}/api/acme/set?token=${CERTBOT_TOKEN}&response=${CERTBOT_VALIDATION}"
echo "Set challenge: token=${CERTBOT_TOKEN}"
sleep 2
```

> **Important**: The auth hook must use `http://` (not `https://`). Let's Encrypt validates over HTTP port 80.

**run.sh:**
```bash
#!/bin/sh
set -e
DOMAIN="<your-domain>"   # e.g., 20-12-213-16.nip.io
EMAIL="<your-email>"

echo "=== Starting certbot for ${DOMAIN} ==="
curl -v "http://${DOMAIN}/api/health" 2>&1 || echo "HTTP connectivity check"

certbot certonly \
  --manual \
  --preferred-challenges http \
  --manual-auth-hook /usr/local/bin/auth-hook.sh \
  --agree-tos \
  --email "${EMAIL}" \
  -d "${DOMAIN}" \
  --no-eff-email \
  --non-interactive \
  --force-renewal

echo "=== Certificate obtained ==="
curl -s -X POST "http://${DOMAIN}/api/acme/cert" \
  -H "x-cert-type: fullchain" \
  --data-binary "@/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

curl -s -X POST "http://${DOMAIN}/api/acme/cert" \
  -H "x-cert-type: privkey" \
  --data-binary "@/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

echo "=== Certificates posted to backend ==="
```

Build in ACR:

```bash
az acr build --registry "$ACR_NAME" \
  --image "certbot-runner:v1" \
  --file /tmp/certbot-build/Dockerfile /tmp/certbot-build/ -o none
```

### 18d. Create and Run the Certbot Container Apps Job

> **Why Container Apps Job instead of ACI?** UHG policy (`ContainerInstanceGroupsShouldDeployIntoVnet`) blocks standalone ACI. Container Apps Jobs run inside the existing CAE which already has VNet integration and internet access.

```bash
# Get ACR credentials
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query "passwords[0].value" -o tsv)

# Create the job
az containerapp job create \
  --resource-group "$RG" \
  --name certbot-job \
  --environment "$CAE_NAME" \
  --image "${ACR_NAME}.azurecr.io/certbot-runner:v1" \
  --trigger-type Manual \
  --replica-timeout 600 \
  --replica-retry-limit 0 \
  --cpu 0.25 --memory 0.5Gi \
  --registry-server "${ACR_NAME}.azurecr.io" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --replica-completion-count 1 \
  --parallelism 1

# Start the job
EXEC_NAME=$(az containerapp job start -g "$RG" -n certbot-job --query 'name' -o tsv)
echo "Job execution: $EXEC_NAME"

# Wait ~90 seconds, then check status
sleep 90
az containerapp job execution show -g "$RG" -n certbot-job \
  --job-execution-name "$EXEC_NAME" --query 'properties.status' -o tsv
# Expected: Succeeded
```

### 18e. Retrieve the Certificate and Upload to AppGW

The certbot job POSTed the cert and key to the backend's in-memory store. Retrieve them:

```bash
# Download fullchain and private key
curl -sk "https://${CERT_DOMAIN}/api/acme/cert/fullchain" > /tmp/le-fullchain.pem
curl -sk "https://${CERT_DOMAIN}/api/acme/cert/privkey" > /tmp/le-privkey.pem

# Verify the certificate
openssl x509 -in /tmp/le-fullchain.pem -noout -subject -dates -issuer
# Expected: subject=CN=<your-domain>, issuer=...Let's Encrypt...

# Convert to PFX
CERT_PASS="LeCert$(date +%Y)pvs"
openssl pkcs12 -export -out /tmp/le-cert.pfx \
  -inkey /tmp/le-privkey.pem \
  -in /tmp/le-fullchain.pem \
  -passout "pass:${CERT_PASS}"

# Upload to Application Gateway
az network application-gateway ssl-cert create \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  -n cert-le \
  --cert-file /tmp/le-cert.pfx \
  --cert-password "$CERT_PASS"

# Switch the HTTPS listener to use the LE cert
az network application-gateway http-listener update \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  -n httpsListener \
  --ssl-cert cert-le

# Verify — this should succeed WITHOUT -k flag
curl -v "https://${CERT_DOMAIN}/api/health" 2>&1 | grep 'SSL certificate verify'
# Expected: SSL certificate verify ok.
```

### 18f. Clean Up ACME Resources

After the certificate is installed, remove all temporary ACME infrastructure:

```bash
# 1. Remove ACME path rules from AppGW
az network application-gateway url-path-map rule delete \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  --path-map-name urlPathMap -n acmeRule -o none

az network application-gateway url-path-map rule delete \
  --gateway-name "$APPGW_NAME" -g "$RG" \
  --path-map-name urlPathMapHttps -n acmeRuleHttps -o none

# 2. Delete the certbot job
az containerapp job delete -g "$RG" -n certbot-job -y -o none

# 3. Remove the old self-signed cert (if present)
az network application-gateway ssl-cert delete \
  --gateway-name "$APPGW_NAME" -g "$RG" -n pvs-ssl-cert -o none 2>/dev/null || true

# 4. Revert ACME code from backend/app/main.py
#    Remove the ACME endpoint code added in §18a, then rebuild and deploy:
az acr build --registry "$ACR_NAME" --image "pvs-api:clean" \
  --file backend/Dockerfile backend/ \
  --build-arg "CACHE_BUST=$(date +%s)" -o none
az containerapp update -g "$RG" -n pvs-api \
  --image "${ACR_NAME}.azurecr.io/pvs-api:clean"

# 5. Clean up local temp files
rm -f /tmp/le-fullchain.pem /tmp/le-privkey.pem /tmp/le-cert.pfx
```

### 18g. Certificate Renewal

Let's Encrypt certificates are valid for **90 days**. To renew:

1. Re-add the ACME code to `main.py` (§18a) and redeploy
2. Re-add the ACME path rules (§18b)
3. Rebuild the certbot image with `--force-renewal` (§18c)
4. Re-create and run the certbot job (§18d)
5. Download the new cert and update AppGW (§18e)
6. Clean up (§18f)

> **Tip**: Keep the certbot image in ACR (`certbot-runner:v1`) — you only need to rebuild it if the domain or email changes.

---

## 19. Database Initialization & Seeding

The application automatically initializes the database on first startup:

1. **Schema creation**: The FastAPI lifespan calls `create_all()` which runs SQLAlchemy's `metadata.create_all()` to create tables.
2. **Snapshot load**: If `backend/app/data/snapshot.json` exists, it loads pre-existing encounters/artifacts (only if the DB is empty).
3. **Demo seeding**: `seed_demo_encounters()` inserts sample encounters with pre-drafted artifacts for demo purposes.
4. **Backfill**: Promotes encounters with all-signed artifacts to "signed" status.

### Manual Snapshot Load (Optional)

If you have a snapshot from another environment:

```bash
# From the repository root, with the venv activated and DATABASE_URL set
scripts/db_snapshot.sh load
# or to force-load even if DB is not empty:
scripts/db_snapshot.sh load --force
```

### Manual Snapshot Dump

```bash
scripts/db_snapshot.sh dump   # writes to backend/app/data/snapshot.json
```

---

## 20. DNS Configuration (Optional Custom Domain)

For production, you'll want a real domain instead of the bare IP or nip.io.

### With a Custom Domain

1. **Create a DNS A record**: Point `pvs.yourdomain.com` → `$PUBLIC_IP`
2. **Update CORS origins** on the pvs-api container:
   ```bash
   az containerapp update -n pvs-api -g "$RG" \
     --set-env-vars "API_CORS_ORIGINS=https://pvs.yourdomain.com,http://localhost:5173"
   ```
3. **Upload a real TLS certificate** for your domain to the Application Gateway
4. **Optionally add HTTP→HTTPS redirect** on the Application Gateway

---

## 21. Validation Checklist

Run these checks after deployment to verify everything works:

```bash
# 1. Frontend health
curl -s -o /dev/null -w "Frontend: HTTP %{http_code}\n" "http://${PUBLIC_IP}/"

# 2. API health
curl -s -w "\nAPI: HTTP %{http_code}\n" "http://${PUBLIC_IP}/api/health"
# Expected: {"ok":true,"azure_configured":true}

# 3. File upload transcription (requires a test audio file)
curl -s --max-time 180 -w "\nHTTP %{http_code}\n" \
  -X POST "http://${PUBLIC_IP}/api/transcribe" \
  -F "file=@test-data/audio/01_copd_exacerbation.m4a"

# 4. HTTPS (if configured with self-signed cert)
curl -sk -o /dev/null -w "HTTPS Frontend: %{http_code}\n" "https://${CERT_DOMAIN}/"
curl -sk -w "\nHTTPS API: %{http_code}\n" "https://${CERT_DOMAIN}/api/health"

# 5. HTTPS trust verification (after Let's Encrypt cert — §18)
#    This MUST work WITHOUT -k flag if using a trusted cert
curl -s -o /dev/null -w "Trusted HTTPS: %{http_code}\n" "https://${CERT_DOMAIN}/"
curl -v "https://${CERT_DOMAIN}/api/health" 2>&1 | grep 'SSL certificate verify'
# Expected: SSL certificate verify ok.

# 6. Check container logs
az containerapp logs show -n pvs-api -g "$RG" --tail 50
az containerapp logs show -n pvs-web -g "$RG" --tail 50

# 6. WebSocket test (live transcription endpoint)
# This requires a WebSocket client or browser testing
```

---

## 22. Environment Variables Reference

### pvs-api (Backend)

| Variable | Example | Source | Description |
|----------|---------|--------|-------------|
| `APP_ENV` | `prod` | Plain | Application environment mode |
| `DATABASE_URL` | `postgresql+asyncpg://...` | **Secret** | PostgreSQL connection string |
| `API_CORS_ORIGINS` | `https://domain,http://ip` | Plain | Comma-separated CORS origins |
| `UAIS_TOKEN_URL` | `https://api.uhg.com/oauth2/token` | Plain | UHG OAuth2 token endpoint |
| `UAIS_COMPLETIONS_ENDPOINT` | `https://api.uhg.com/api/cloud/...` | Plain | UHG AI Gateway completions endpoint |
| `UAIS_API_VERSION` | `2025-01-01-preview` | Plain | Azure OpenAI API version |
| `UAIS_DEPLOYMENT` | `gpt-5.2_2025-12-11` | Plain | LLM model deployment name |
| `UAIS_WHISPER_DEPLOYMENT` | `whisper` | Plain | Whisper model deployment name |
| `UAIS_PROJECT_ID` | `5376aa9e-...` | Plain | UAIS project identifier |
| `HCP_CLIENT_ID` | `fc149866-...` | Plain | OAuth2 client ID |
| `HCP_CLIENT_SECRETE` | `<secret>` | **Secret** | OAuth2 client secret |
| `HCP_SCOPE` | `https://api.uhg.com/.default` | Plain | OAuth2 scope |
| `AZURE_SPEECH_KEY` | `6clue9nu...` | Plain* | Speech service subscription key |
| `AZURE_SPEECH_REGION` | `centralus` | Plain | Speech service region |
| `AZURE_SPEECH_ENDPOINT` | `https://speech-pvs-demo.cognitiveservices.azure.com` | Plain | Speech custom domain endpoint |
| `AZURE_SPEECH_CLIENT_ID` | (optional) | Plain | AAD app client ID for speech |
| `AZURE_SPEECH_CLIENT_SECRET` | (optional) | **Secret** | AAD app client secret for speech |
| `AZURE_SPEECH_TENANT_ID` | (optional) | Plain | AAD tenant ID |
| `AZURE_SPEECH_RESOURCE_ID` | (optional) | Plain | Speech resource ID (for AAD auth) |

> \* Consider moving `AZURE_SPEECH_KEY` to a secret ref in production.

### pvs-web (Frontend)

| Build Arg | Value | Description |
|-----------|-------|-------------|
| `VITE_API_BASE_URL` | `""` (empty) | Relative URLs when fronted by AppGW |

---

## 23. Operational Notes

### Updating Environment Variables

```bash
az containerapp update -n pvs-api -g "$RG" \
  --set-env-vars "VARIABLE_NAME=new-value"

# For secrets:
az containerapp secret set -n pvs-api -g "$RG" \
  --secrets "secret-name=secret-value"
```

### Viewing Logs

```bash
# Real-time streaming
az containerapp logs show -n pvs-api -g "$RG" --tail 100 --follow

# Historical (via Log Analytics)
az monitor log-analytics query \
  -w "$LAW_ID" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'pvs-api' | order by TimeGenerated desc | take 100"
```

### Scaling

```bash
# Adjust min/max replicas
az containerapp update -n pvs-api -g "$RG" --min-replicas 2 --max-replicas 5
```

### Rebuilding & Redeploying

```bash
# Increment the version tag each time
VERSION="v3"

# Backend
az acr build --registry "$ACR_NAME" --image "pvs-api:${VERSION}" --file backend/Dockerfile backend/
az containerapp update -n pvs-api -g "$RG" --image "${ACR_LOGIN_SERVER}/pvs-api:${VERSION}"

# Frontend
az acr build --registry "$ACR_NAME" --image "pvs-web:${VERSION}" --build-arg VITE_API_BASE_URL="" --file web/Dockerfile.prod web/
az containerapp update -n pvs-web -g "$RG" --image "${ACR_LOGIN_SERVER}/pvs-web:${VERSION}"
```

### Cost-Saving Tips

- **PostgreSQL**: `Standard_B1ms` (Burstable) is cheapest for dev/demo. For production, consider `Standard_D2ds_v5` or higher.
- **Application Gateway**: Standard_v2 with `capacity 1` is the minimum. Enable autoscaling for production.
- **Container Apps**: Consumption plan bills per-request + vCPU-seconds. Set `min-replicas 0` for non-critical apps to scale to zero.
- **ACR**: Basic SKU is sufficient. Consider Standard for geo-replication.

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| CORS errors in browser | `API_CORS_ORIGINS` missing your domain | Update env var on pvs-api |
| 502 from AppGW | Backend pool unhealthy | Check probes, verify CAE DNS resolution |
| Speech 403 | VNet firewall blocking access | Ensure CAE subnet in Speech VNet rules, PE+DNS configured |
| Mic not working | Not using HTTPS | Access via HTTPS (required for `getUserMedia`) |
| WS connection failed | AppGW timeout | Increase `apiHttpSettings` timeout; AppGW v2 supports WS natively |
| DB connection timeout | PE DNS not resolving | Verify private DNS zone linked to VNet |
| Revision stuck in "Activating" | KV secret refs can't resolve or DB unreachable | Remove all KV-backed secret defs; add PG firewall rules (see §8b, §12) |
| Container logs: "Could not find container" | Container crash-looping before logs attach | Check if KV secrets or DB connectivity is blocking startup |
| Zscaler blocks `curl` to public IP | Corporate proxy intercepts HTTP to bare IPs | Test from non-corporate network; use HTTPS with a real domain |
| `RequestDisallowedByPolicy` on KV | UHG policy blocks `defaultAction: Allow` | Use direct env vars instead of KV secret refs (see §12 warning) |
| No seeded data after deploy | App couldn't connect to DB on first start | Fix DB access (firewall rules), then restart the container app; auto-seed runs on startup |
| `RequestDisallowedByPolicy` on Speech | UHG policy requires `publicNetworkAccess: Disabled` at creation time | Use `az rest --method PUT` instead of `az cognitiveservices account create` (see §10a) |
| `CustomDomainInUse` on Speech | Custom subdomain was used by a deleted resource | Choose a different name (e.g., append random suffix); deleted resources block the name for 48 hours |
| `The content for this response was already consumed` | az CLI bug with ARM deployment streaming (often Zscaler-related) | Use `az rest --method PUT` instead of `az deployment group create` |
| PE IP query returns empty | JMESPath `customDnsConfigs[0].ipAddresses[0]` empty for some PE types | Use NIC query: `az network nic show --ids <nic-id> --query 'ipConfigurations[0].privateIPAddress'` (see §11c) |
| `/api/*` returns frontend HTML over HTTPS | HTTPS URL path map uses wrong HTTP settings (`appGatewayBackendHttpSettings` instead of `apiHttpSettings`) | Delete and recreate URL path map with `--http-settings apiHttpSettings` for the API rule (see §17c) |
| `dquote>` prompt stuck in terminal | Password or string contains `!` inside double quotes (zsh history expansion) | Avoid `!` in passwords/strings; use alphanumeric only in shell commands |
| `--default-backend-pool` unrecognized | Wrong CLI parameter name for `url-path-map create` | Use `--default-address-pool` and `--default-http-settings` instead |
| `Multiple backend address pools found` | AppGW rule create requires explicit pool when multiple exist | Add `--address-pool` and `--http-settings` to the `rule create` command |
| Browser shows "untrusted website" | Self-signed cert on AppGW | Replace with Let's Encrypt cert (see §18) |
| Certbot `SSL: CERTIFICATE_VERIFY_FAILED` locally | Zscaler/corporate proxy intercepts HTTPS to ACME server | Run certbot in a Container Apps Job instead (see §18d) |
| `RequestDisallowedByPolicy` on ACI | UHG policy requires ACI in VNet | Use Container Apps Job instead of ACI (see §18d) |
| Certbot job `Failed` | Deprecated flag `--manual-public-ip-logging-ok` | Remove that flag; it was removed in certbot v2+ |
| ACR build produces same digest | Docker layer cache reused old code | Add `--build-arg "CACHE_BUST=$(date +%s)"` to force a fresh build |
| Certbot job logs "No replicas found" | Replica already terminated | Use the in-memory cert store approach — POST certs to backend and retrieve via API (see §18e) |

---

## Quick-Start Script (All-in-One)

For convenience, here's a condensed script that runs all steps. **Review and customize before running.**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# CUSTOMIZE THESE VALUES
# ═══════════════════════════════════════════════════════════════════════════
export SUB_ID="<subscription-id>"
export LOCATION="centralus"
export RG="rg-pvs"
SUFFIX=$(openssl rand -hex 3)

export ACR_NAME="acrpvs${SUFFIX}"
export PG_SERVER="pg-pvs-${SUFFIX}"
export KV_NAME="kv-pvs-${SUFFIX}"
export SPEECH_NAME="speech-pvs-${SUFFIX}"
export VNET_NAME="vnet-pvs"
export CAE_NAME="cae-pvs"
export LAW_NAME="law-pvs"
export PIP_NAME="pip-appgw-pvs"
export APPGW_NAME="appgw-pvs"
export PG_ADMIN_USER="pvsadmin"
export PG_ADMIN_PASS="$(openssl rand -base64 24)"
export PG_DB_NAME="pvs"

echo "Suffix: $SUFFIX"
echo "PG Password: $PG_ADMIN_PASS"
echo "Save these values!"
read -p "Press Enter to continue..."

az account set -s "$SUB_ID"

echo "Step 1: Resource Group"
az group create -n "$RG" -l "$LOCATION" -o none

echo "Step 2: VNet"
az network vnet create -g "$RG" -n "$VNET_NAME" --address-prefix 10.40.0.0/16 -l "$LOCATION" -o none
az network vnet subnet create -g "$RG" --vnet-name "$VNET_NAME" -n snet-cae --address-prefix 10.40.0.0/23 --delegations Microsoft.App/environments -o none
az network vnet subnet create -g "$RG" --vnet-name "$VNET_NAME" -n snet-pe --address-prefix 10.40.2.0/24 -o none
az network vnet subnet create -g "$RG" --vnet-name "$VNET_NAME" -n snet-appgw --address-prefix 10.40.3.0/24 -o none
az network vnet subnet update -g "$RG" --vnet-name "$VNET_NAME" -n snet-cae --service-endpoints Microsoft.CognitiveServices -o none

echo "Step 3: Log Analytics"
az monitor log-analytics workspace create -g "$RG" -n "$LAW_NAME" -l "$LOCATION" --retention-time 30 -o none
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW_NAME" --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LAW_NAME" --query primarySharedKey -o tsv)

echo "Step 4: ACR"
az acr create -g "$RG" -n "$ACR_NAME" --sku Basic --admin-enabled true -l "$LOCATION" -o none
ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"
ACR_PASSWORD=$(az acr credential show -n "$ACR_NAME" --query "passwords[0].value" -o tsv)

echo "Step 5: PostgreSQL"
az postgres flexible-server create -g "$RG" -n "$PG_SERVER" -l "$LOCATION" --admin-user "$PG_ADMIN_USER" --admin-password "$PG_ADMIN_PASS" --sku-name Standard_B1ms --tier Burstable --version 16 --storage-size 32 --public-access 0.0.0.0 --yes -o none
az postgres flexible-server db create -g "$RG" -s "$PG_SERVER" -d "$PG_DB_NAME" -o none
DATABASE_URL="postgresql+asyncpg://${PG_ADMIN_USER}:${PG_ADMIN_PASS}@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB_NAME}?ssl=require"

echo "Step 6: PostgreSQL Private Endpoint + DNS"
PG_RID=$(az postgres flexible-server show -g "$RG" -n "$PG_SERVER" --query id -o tsv)
az network private-endpoint create -g "$RG" -n "pe-pg" --vnet-name "$VNET_NAME" --subnet snet-pe --private-connection-resource-id "$PG_RID" --group-id postgresqlServer --connection-name pg-conn -l "$LOCATION" -o none
az network private-dns zone create -g "$RG" -n privatelink.postgres.database.azure.com -o none
az network private-dns link vnet create -g "$RG" --zone-name privatelink.postgres.database.azure.com -n pg-link --virtual-network "$VNET_NAME" --registration-enabled false -o none
PE_PG_IP=$(az network private-endpoint show -g "$RG" -n pe-pg --query "customDnsConfigs[0].ipAddresses[0]" -o tsv)
az network private-dns record-set a create -g "$RG" -z privatelink.postgres.database.azure.com -n "$PG_SERVER" -o none
az network private-dns record-set a add-record -g "$RG" -z privatelink.postgres.database.azure.com -n "$PG_SERVER" -a "$PE_PG_IP" -o none

echo "Step 7: Speech Service (using REST API for UHG policy compliance)"
az rest --method PUT \
  --url "https://management.azure.com/subscriptions/${SUB_ID}/resourceGroups/${RG}/providers/Microsoft.CognitiveServices/accounts/${SPEECH_NAME}?api-version=2023-10-01-preview" \
  --body "{\"location\":\"${LOCATION}\",\"kind\":\"SpeechServices\",\"sku\":{\"name\":\"S0\"},\"properties\":{\"customSubDomainName\":\"${SPEECH_NAME}\",\"publicNetworkAccess\":\"Disabled\",\"networkAcls\":{\"defaultAction\":\"Deny\"}}}" \
  --query 'properties.provisioningState' -o tsv
SPEECH_KEY=$(az cognitiveservices account keys list -g "$RG" -n "$SPEECH_NAME" --query key1 -o tsv)
SPEECH_ENDPOINT=$(az cognitiveservices account show -g "$RG" -n "$SPEECH_NAME" --query properties.endpoint -o tsv)

echo "Step 8: Speech Private Endpoint + DNS"
SPEECH_RID=$(az cognitiveservices account show -g "$RG" -n "$SPEECH_NAME" --query id -o tsv)
az network private-endpoint create -g "$RG" -n pe-speech --vnet-name "$VNET_NAME" --subnet snet-pe --private-connection-resource-id "$SPEECH_RID" --group-id account --connection-name speech-conn -l "$LOCATION" -o none
az network private-dns zone create -g "$RG" -n privatelink.cognitiveservices.azure.com -o none
az network private-dns link vnet create -g "$RG" --zone-name privatelink.cognitiveservices.azure.com -n speech-link --virtual-network "$VNET_NAME" --registration-enabled false -o none
PE_SP_NIC=$(az network private-endpoint show -g "$RG" -n pe-speech --query 'networkInterfaces[0].id' -o tsv)
PE_SP_IP=$(az network nic show --ids "$PE_SP_NIC" --query 'ipConfigurations[0].privateIPAddress' -o tsv)
az network private-dns record-set a add-record -g "$RG" -z privatelink.cognitiveservices.azure.com -n "$SPEECH_NAME" -a "$PE_SP_IP" -o none

echo "Step 9: Key Vault (RBAC mode, firewall deny-by-default)"
echo "  NOTE: Do NOT use KV secret refs on Container Apps — use direct env vars instead."
az keyvault create -g "$RG" -n "$KV_NAME" -l "$LOCATION" --sku standard --enable-rbac-authorization true --default-action Deny -o none

echo "Step 10: Container Apps Environment"
SNET_CAE_ID=$(az network vnet subnet show -g "$RG" --vnet-name "$VNET_NAME" -n snet-cae --query id -o tsv)
az containerapp env create -g "$RG" -n "$CAE_NAME" -l "$LOCATION" --logs-workspace-id "$LAW_ID" --logs-workspace-key "$LAW_KEY" --infrastructure-subnet-resource-id "$SNET_CAE_ID" --internal-only true -o none
CAE_STATIC_IP=$(az containerapp env show -g "$RG" -n "$CAE_NAME" --query properties.staticIp -o tsv)
CAE_DOMAIN=$(az containerapp env show -g "$RG" -n "$CAE_NAME" --query properties.defaultDomain -o tsv)

echo "Step 11: CAE DNS Zone"
az network private-dns zone create -g "$RG" -n "$CAE_DOMAIN" -o none
az network private-dns link vnet create -g "$RG" --zone-name "$CAE_DOMAIN" -n cae-link --virtual-network "$VNET_NAME" --registration-enabled false -o none
az network private-dns record-set a create -g "$RG" -z "$CAE_DOMAIN" -n "*" -o none
az network private-dns record-set a add-record -g "$RG" -z "$CAE_DOMAIN" -n "*" -a "$CAE_STATIC_IP" -o none
az network private-dns record-set a create -g "$RG" -z "$CAE_DOMAIN" -n "@" -o none
az network private-dns record-set a add-record -g "$RG" -z "$CAE_DOMAIN" -n "@" -a "$CAE_STATIC_IP" -o none

echo "== Build and deploy containers =="
echo "Run the containerapp create commands from Sections 14 & 15 manually (require env-specific secrets)"
echo ""
echo "== IMPORTANT: After creating pvs-api, add PostgreSQL firewall rules =="
echo "  See Section 8b — Container Apps use 100+ shared outbound IPs."
echo "  Add broad IP range rules BEFORE the app tries to connect to PG."
echo "  Use: az containerapp show -g $RG -n pvs-api --query properties.outboundIpAddresses"

echo ""
echo "═══════════════════════════════════════════"
echo "Deployment values to save:"
echo "  Suffix:       $SUFFIX"
echo "  PG Password:  $PG_ADMIN_PASS"
echo "  ACR Password: $ACR_PASSWORD"
echo "  Speech Key:   $SPEECH_KEY"
echo "  Speech EP:    $SPEECH_ENDPOINT"
echo "  DB URL:       $DATABASE_URL"
echo "  CAE IP:       $CAE_STATIC_IP"
echo "  CAE Domain:   $CAE_DOMAIN"
echo "═══════════════════════════════════════════"
echo ""
echo "== NEXT STEPS (manual) =="
echo "  1. Build & deploy pvs-api and pvs-web (Sections 14 & 15)"
echo "  2. Configure TLS with self-signed cert (Section 17)"
echo "  3. Replace with Let's Encrypt trusted cert (Section 18)"
echo "     This makes the URL trusted by browsers — no security warnings."
```

---

*Last updated: April 2026*
