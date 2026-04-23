// Post-Visit Summary — Container App + Easy Auth.
//
// Deploy AFTER main.bicep has run and an image has been pushed to ACR.
//
// Usage:
//   az deployment group create -g rg-pvs-demo \
//     --template-file containerapp.bicep \
//     --parameters containerapp.parameters.json

targetScope = 'resourceGroup'

// --- identity ---
@description('Entra tenant ID (UHG).')
param tenantId string

@description('Entra Application (client) ID for the backend API SP — used as Easy Auth audience.')
param apiSpClientId string

@secure()
@description('Entra client secret for the backend API SP (Easy Auth).')
param apiSpClientSecret string

// --- infra references (outputs from main.bicep) ---
@description('Resource ID of the Container Apps Environment.')
param caeId string

@description('ACR login server (e.g. acrpvsdemo123abc.azurecr.io).')
param acrLoginServer string

@description('Name of the ACR resource (for credential pull).')
param acrName string

@description('Name of the Key Vault holding secrets.')
param kvName string

// --- image ---
@description('Full image reference (e.g. acrpvsdemo.azurecr.io/pvs-api:abc123).')
param image string = ''

// --- app config ---
@description('Allowed CORS origins (comma-separated).')
param apiCorsOrigins string = '*'

@description('Azure region.')
param location string = resourceGroup().location

@description('Short project tag.')
param project string = 'pvs'

@description('Environment tag.')
param env string = 'demo'

var commonTags = {
  project: project
  env: env
  'managed-by': 'bicep'
}

var appName = '${project}-api'

// Reference existing resources from main.bicep deployment.
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: kvName
}

// --- Container App ---
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: caeId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'http'
        allowInsecure: false
        // Increase idle timeout for long-running SSE streams.
        clientCertificateMode: 'ignore'
      }
      registries: [
        {
          server: acrLoginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        // ACR pull credential
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
        // Easy Auth client secret (Entra AD provider)
        {
          name: 'microsoft-provider-authentication-secret'
          value: apiSpClientSecret
        }
        // Key Vault references — Container Apps resolve these at runtime
        // via the system-assigned managed identity.
        { name: 'kv-uais-token-url',            keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-TOKEN-URL',            identity: 'system' }
        { name: 'kv-uais-completions-endpoint',  keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-COMPLETIONS-ENDPOINT', identity: 'system' }
        { name: 'kv-uais-api-version',           keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-API-VERSION',          identity: 'system' }
        { name: 'kv-uais-deployment',            keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-DEPLOYMENT',           identity: 'system' }
        { name: 'kv-uais-whisper-deployment',    keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-WHISPER-DEPLOYMENT',   identity: 'system' }
        { name: 'kv-uais-project-id',            keyVaultUrl: '${kv.properties.vaultUri}secrets/UAIS-PROJECT-ID',           identity: 'system' }
        { name: 'kv-hcp-client-id',              keyVaultUrl: '${kv.properties.vaultUri}secrets/HCP-CLIENT-ID',             identity: 'system' }
        { name: 'kv-hcp-client-secrete',         keyVaultUrl: '${kv.properties.vaultUri}secrets/HCP-CLIENT-SECRETE',        identity: 'system' }
        { name: 'kv-hcp-scope',                  keyVaultUrl: '${kv.properties.vaultUri}secrets/HCP-SCOPE',                 identity: 'system' }
        { name: 'kv-pg-host',                    keyVaultUrl: '${kv.properties.vaultUri}secrets/PG-HOST',                   identity: 'system' }
        { name: 'kv-pg-port',                    keyVaultUrl: '${kv.properties.vaultUri}secrets/PG-PORT',                   identity: 'system' }
        { name: 'kv-pg-database',                keyVaultUrl: '${kv.properties.vaultUri}secrets/PG-DATABASE',               identity: 'system' }
        { name: 'kv-pg-user',                    keyVaultUrl: '${kv.properties.vaultUri}secrets/PG-USER',                   identity: 'system' }
        { name: 'kv-pg-password',                keyVaultUrl: '${kv.properties.vaultUri}secrets/PG-PASSWORD',               identity: 'system' }
      ]
    }
    template: {
      containers: [
        {
          name: 'pvs-api'
          image: !empty(image) ? image : '${acrLoginServer}/pvs-api:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            // Plain-text env vars
            { name: 'APP_ENV',           value: 'prod' }
            { name: 'API_CORS_ORIGINS',  value: apiCorsOrigins }
            // Key Vault–backed secrets → env vars the app expects
            { name: 'UAIS_TOKEN_URL',            secretRef: 'kv-uais-token-url' }
            { name: 'UAIS_COMPLETIONS_ENDPOINT', secretRef: 'kv-uais-completions-endpoint' }
            { name: 'UAIS_API_VERSION',          secretRef: 'kv-uais-api-version' }
            { name: 'UAIS_DEPLOYMENT',           secretRef: 'kv-uais-deployment' }
            { name: 'UAIS_WHISPER_DEPLOYMENT',   secretRef: 'kv-uais-whisper-deployment' }
            { name: 'UAIS_PROJECT_ID',           secretRef: 'kv-uais-project-id' }
            { name: 'HCP_CLIENT_ID',             secretRef: 'kv-hcp-client-id' }
            { name: 'HCP_CLIENT_SECRETE',        secretRef: 'kv-hcp-client-secrete' }
            { name: 'HCP_SCOPE',                 secretRef: 'kv-hcp-scope' }
            { name: 'PG_HOST',                   secretRef: 'kv-pg-host' }
            { name: 'PG_PORT',                   secretRef: 'kv-pg-port' }
            { name: 'PG_DATABASE',               secretRef: 'kv-pg-database' }
            { name: 'PG_USER',                   secretRef: 'kv-pg-user' }
            { name: 'PG_PASSWORD',               secretRef: 'kv-pg-password' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 8000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 8000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-scaling'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

// --- Grant the Container App's managed identity Key Vault Secrets User ---
resource kvRoleApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, app.id, 'Key Vault Secrets User')
  scope: kv
  properties: {
    // Key Vault Secrets User built-in role
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Easy Auth (Entra ID / Azure AD) ---
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: app
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: 'https://sts.windows.net/${tenantId}/v2.0'
          clientId: apiSpClientId
          clientSecretSettingName: 'microsoft-provider-authentication-secret'
        }
        validation: {
          allowedAudiences: [
            'api://${apiSpClientId}'
            apiSpClientId
          ]
        }
      }
    }
  }
}

// --- Outputs ---
output appFqdn string = app.properties.configuration.ingress.fqdn
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output appPrincipalId string = app.identity.principalId
