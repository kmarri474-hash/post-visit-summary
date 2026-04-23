// Post-Visit Summary — demo/POC infrastructure.
//
// Deploys, in a single resource group:
//   - Azure Container Registry (Basic)
//   - Log Analytics workspace
//   - Container Apps Environment
//   - Azure Database for PostgreSQL Flexible Server (Burstable B1ms)
//   - Key Vault with secrets populated from deployment parameters
//
// The Container App itself is deployed by a second template (containerapp.bicep)
// AFTER an image has been pushed to ACR, so this template is idempotent and
// safe to re-run.

targetScope = 'resourceGroup'

@description('Short project tag used for naming.')
param project string = 'pvs'

@description('Environment tag (demo/staging/prod).')
param env string = 'demo'

@description('Azure region.')
param location string = resourceGroup().location

@description('Entra tenant ID.')
param tenantId string

@description('Admin user for Postgres Flexible Server.')
param pgAdminUser string = 'pvsadmin'

@secure()
@description('Admin password for Postgres Flexible Server.')
param pgAdminPassword string

@description('Postgres database name created on first boot.')
param pgDatabaseName string = 'pvs'

// --- UAIS / HCP credentials (forwarded into Key Vault) ---
@description('UAIS token endpoint (OAuth2 client-credentials).')
param uaisTokenUrl string

@description('UAIS completions endpoint base URL.')
param uaisCompletionsEndpoint string

@description('UAIS API version.')
param uaisApiVersion string = '2024-08-01-preview'

@description('UAIS chat model deployment name.')
param uaisDeployment string = 'gpt-4o'

@description('UAIS Whisper deployment name.')
param uaisWhisperDeployment string = 'whisper'

@description('UAIS projectId header value.')
param uaisProjectId string

@description('HCP OAuth2 client id.')
param hcpClientId string

@secure()
@description('HCP OAuth2 client secret.')
param hcpClientSecret string

@description('HCP OAuth2 scope.')
param hcpScope string

// --- SP object IDs that get Key Vault access (Container App MI added later) ---
@description('Object ID of the deploy/API SP to grant KV access.')
param deploySpObjectId string

// --- naming ---
// ACR names must be globally unique, alphanumeric, 5-50 chars.
var suffix = uniqueString(resourceGroup().id)
var acrName = toLower('acr${project}${env}${substring(suffix, 0, 6)}')
var lawName = 'law-${project}-${env}'
var caeName = 'cae-${project}-${env}'
var pgName = toLower('pg-${project}-${env}-${substring(suffix, 0, 6)}')
var kvName = toLower('kv-${project}-${env}-${substring(suffix, 0, 6)}')

var commonTags = {
  project: project
  env: env
  'managed-by': 'bicep'
}

// --- Log Analytics ---
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: commonTags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

// --- ACR ---
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: commonTags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

// --- VNet for Container Apps (required by UHG policy
// `ContainerAppEnvsShouldDisablePubNetAccess`). The environment is deployed
// with internal=true, so it gets a private ILB endpoint only and is
// reachable from UHG corporate network / VPN. ---
resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-${project}-${env}'
  location: location
  tags: commonTags
  properties: {
    addressSpace: { addressPrefixes: [ '10.40.0.0/16' ] }
    subnets: [
      {
        // ACA consumption workload profile: /23 minimum.
        name: 'snet-cae'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [
            {
              name: 'aca-delegation'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
    ]
  }
}

// --- Container Apps Environment (internal/private) ---
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caeName
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/snet-cae'
      internal: true
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

// --- Postgres Flexible Server (Burstable B1ms, public-access demo) ---
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminUser
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: pgDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// NOTE: the UHG `AzureFlexiblePostgreSQLServerPublicAccessDryRun` policy
// blocks the permissive `AllowAzureServices` (0.0.0.0) firewall rule, so we
// create narrow per-IP rules out-of-band via `az postgres flexible-server
// firewall-rule create` (deploy workstation + Container Apps outbound IPs).

// --- Key Vault (RBAC model, firewall-enabled to satisfy UHG policy) ---
@description('List of IPv4 addresses allowed to reach Key Vault (e.g., the deploy workstation). CIDR or single IPs.')
param kvAllowedIps array = []

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: commonTags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    // Required by UHG policy `KeyVaultsShouldHaveDeletionProtectionEnabled`.
    enablePurgeProtection: true
    // Required by UHG policy `AzureKeyVaultShouldHaveFirewallEnabled`.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
      ipRules: [for ip in kvAllowedIps: { value: ip }]
      virtualNetworkRules: []
    }
  }
}

// Grant deploy SP Key Vault Secrets Officer so it can push/read secrets.
resource kvRoleDeploy 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, deploySpObjectId, 'Secrets Officer')
  scope: kv
  properties: {
    // Key Vault Secrets Officer
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
    )
    principalId: deploySpObjectId
    principalType: 'ServicePrincipal'
  }
}

// --- Static-value secrets (known at deployment start; safe in a for-loop) ---
var staticSecrets = [
  { name: 'UAIS-TOKEN-URL',            value: uaisTokenUrl }
  { name: 'UAIS-COMPLETIONS-ENDPOINT', value: uaisCompletionsEndpoint }
  { name: 'UAIS-API-VERSION',          value: uaisApiVersion }
  { name: 'UAIS-DEPLOYMENT',           value: uaisDeployment }
  { name: 'UAIS-WHISPER-DEPLOYMENT',   value: uaisWhisperDeployment }
  { name: 'UAIS-PROJECT-ID',           value: uaisProjectId }
  { name: 'HCP-CLIENT-ID',             value: hcpClientId }
  { name: 'HCP-CLIENT-SECRETE',        value: hcpClientSecret }
  { name: 'HCP-SCOPE',                 value: hcpScope }
  { name: 'PG-PORT',                   value: '5432' }
  { name: 'PG-DATABASE',               value: pgDatabaseName }
  { name: 'PG-USER',                   value: pgAdminUser }
  { name: 'PG-PASSWORD',               value: pgAdminPassword }
]

resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for s in staticSecrets: {
  parent: kv
  name: s.name
  properties: {
    value: s.value
    contentType: 'text/plain'
  }
  dependsOn: [ kvRoleDeploy ]
}]

// PG-HOST references a runtime output from the Postgres server, so it is
// declared separately (outside the for-loop) per Bicep BCP178.
resource kvPgHost 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'PG-HOST'
  properties: {
    value: pg.properties.fullyQualifiedDomainName
    contentType: 'text/plain'
  }
  dependsOn: [ kvRoleDeploy ]
}

// --- outputs consumed by containerapp.bicep and GH Actions workflows ---
output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output caeId string = cae.id
output caeName string = cae.name
output lawId string = law.id
output pgFqdn string = pg.properties.fullyQualifiedDomainName
output pgDatabase string = pgDatabaseName
output kvName string = kv.name
output kvUri string = kv.properties.vaultUri
