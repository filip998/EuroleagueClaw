# =============================================================================
# Azure Setup Script for EuroleagueClaw (PowerShell)
# =============================================================================
# Provisions all Azure resources needed to run the bot:
#   - Resource Group
#   - Azure Container Registry (Basic)
#   - Storage Account + File Share (for SQLite persistence)
#   - Container Apps Environment with Azure Files mount
#   - Container App with secrets, env vars, and health probes
#   - Service Principal for GitHub Actions deployment
#
# Usage:
#   .\scripts\azure-setup.ps1
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Subscription selected (az account set --subscription <id>)
# =============================================================================

#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration — customize these values
# ---------------------------------------------------------------------------
$ResourceGroup     = "euroleague-claw-rg"
$Location          = "germanywestcentral"
$AcrName           = "euroleagueclawacr"          # Must be globally unique, alphanumeric only
$StorageAccount    = "euroleagueclawsa"            # Must be globally unique, alphanumeric only
$FileShareName     = "euroleague-claw-data"
$ContainerAppEnv   = "euroleague-claw-env"
$ContainerAppName  = "euroleague-claw"
$ImageName         = "euroleague-claw"

# GitHub repo for service principal RBAC scope (format: owner/repo)
$GitHubRepo = "filip998/EuroleagueClaw"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info  { param([string]$Message) Write-Host "`n▶ $Message" -ForegroundColor Blue }
function Write-Ok    { param([string]$Message) Write-Host "  ✓ $Message" -ForegroundColor Green }

# ---------------------------------------------------------------------------
# 1. Resource Group
# ---------------------------------------------------------------------------
Write-Info "Creating resource group: $ResourceGroup"
$rgExists = az group show --name $ResourceGroup 2>$null
if ($rgExists) {
    Write-Ok "Already exists"
} else {
    az group create --name $ResourceGroup --location $Location --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create resource group" }
    Write-Ok "Created"
}

# ---------------------------------------------------------------------------
# 2. Azure Container Registry (Basic tier)
# ---------------------------------------------------------------------------
Write-Info "Creating container registry: $AcrName"
$acrExists = az acr show --name $AcrName --resource-group $ResourceGroup 2>$null
if ($acrExists) {
    Write-Ok "Already exists"
} else {
    az acr create `
        --name $AcrName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Basic `
        --admin-enabled true `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create container registry" }
    Write-Ok "Created"
}

$AcrLoginServer = az acr show --name $AcrName --query loginServer --output tsv
if ($LASTEXITCODE -ne 0) { throw "Failed to get ACR login server" }

# ---------------------------------------------------------------------------
# 3. Storage Account + File Share (SQLite persistence)
# ---------------------------------------------------------------------------
Write-Info "Creating storage account: $StorageAccount"
$saExists = az storage account show --name $StorageAccount --resource-group $ResourceGroup 2>$null
if ($saExists) {
    Write-Ok "Already exists"
} else {
    az storage account create `
        --name $StorageAccount `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Standard_LRS `
        --kind StorageV2 `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create storage account" }
    Write-Ok "Created"
}

$StorageKey = az storage account keys list `
    --account-name $StorageAccount `
    --resource-group $ResourceGroup `
    --query "[0].value" --output tsv
if ($LASTEXITCODE -ne 0) { throw "Failed to get storage key" }

Write-Info "Creating file share: $FileShareName"
$shareExists = az storage share show --name $FileShareName --account-name $StorageAccount --account-key $StorageKey 2>$null
if ($shareExists) {
    Write-Ok "Already exists"
} else {
    az storage share create `
        --name $FileShareName `
        --account-name $StorageAccount `
        --account-key $StorageKey `
        --quota 1 `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create file share" }
    Write-Ok "Created"
}

# ---------------------------------------------------------------------------
# 4. Container Apps Environment
# ---------------------------------------------------------------------------
Write-Info "Creating Container Apps environment: $ContainerAppEnv"
$envExists = az containerapp env show --name $ContainerAppEnv --resource-group $ResourceGroup 2>$null
if ($envExists) {
    Write-Ok "Already exists"
} else {
    az containerapp env create `
        --name $ContainerAppEnv `
        --resource-group $ResourceGroup `
        --location $Location `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Container Apps environment" }
    Write-Ok "Created"
}

# ---------------------------------------------------------------------------
# 5. Link Azure Files storage to the environment
# ---------------------------------------------------------------------------
Write-Info "Linking Azure Files to Container Apps environment"
$existingStorage = az containerapp env storage show `
    --name $ContainerAppEnv `
    --resource-group $ResourceGroup `
    --storage-name "botdata" 2>$null

if ($existingStorage) {
    Write-Ok "Storage link already exists"
} else {
    az containerapp env storage set `
        --name $ContainerAppEnv `
        --resource-group $ResourceGroup `
        --storage-name "botdata" `
        --azure-file-account-name $StorageAccount `
        --azure-file-account-key $StorageKey `
        --azure-file-share-name $FileShareName `
        --access-mode ReadWrite `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to link Azure Files storage" }
    Write-Ok "Linked"
}

# ---------------------------------------------------------------------------
# 6. Build and push initial image
# ---------------------------------------------------------------------------
Write-Info "Building and pushing initial image to ACR"
az acr build `
    --registry $AcrName `
    --resource-group $ResourceGroup `
    --image "${ImageName}:latest" `
    . `
    --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to build and push image" }
Write-Ok "Image pushed to $AcrLoginServer/${ImageName}:latest"

# ---------------------------------------------------------------------------
# 7. Create the Container App
# ---------------------------------------------------------------------------
Write-Info "Creating Container App: $ContainerAppName"
$appExists = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup 2>$null
if ($appExists) {
    Write-Ok "Already exists — updating image"
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroup `
        --image "$AcrLoginServer/${ImageName}:latest" `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to update container app" }
} else {
    $acrPassword = az acr credential show --name $AcrName --query "passwords[0].value" --output tsv
    if ($LASTEXITCODE -ne 0) { throw "Failed to get ACR credentials" }

    az containerapp create `
        --name $ContainerAppName `
        --resource-group $ResourceGroup `
        --environment $ContainerAppEnv `
        --image "$AcrLoginServer/${ImageName}:latest" `
        --registry-server $AcrLoginServer `
        --registry-username $AcrName `
        --registry-password $acrPassword `
        --min-replicas 1 `
        --max-replicas 1 `
        --cpu 0.25 `
        --memory 0.5Gi `
        --ingress external `
        --target-port 8080 `
        --secrets `
            "telegram-bot-token=REPLACE_WITH_YOUR_TELEGRAM_BOT_TOKEN" `
            "dunkest-bearer-token=REPLACE_WITH_YOUR_DUNKEST_BEARER_TOKEN" `
        --env-vars `
            "TELEGRAM_BOT_TOKEN=secretref:telegram-bot-token" `
            "TELEGRAM_ALLOWED_CHAT_IDS=" `
            "DUNKEST_BEARER_TOKEN=secretref:dunkest-bearer-token" `
            "DUNKEST_FANTASY_TEAM_IDS=" `
            "EUROLEAGUE_SEASON_CODE=E2025" `
            "EUROLEAGUE_COMPETITION_CODE=E" `
            "EUROLEAGUE_POLL_INTERVAL_MS=10000" `
            "LOG_LEVEL=info" `
            "NODE_ENV=production" `
            "DATABASE_PATH=/app/data/euroleague-claw.db" `
            "HEALTH_PORT=8080" `
            "THROTTLE_WINDOW_SECONDS=120" `
            "THROTTLE_MAX_MESSAGES_PER_MINUTE=5" `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create container app" }
    Write-Ok "Created"

    # Add volume mount (must be done after creation)
    Write-Info "Attaching Azure Files volume to container"
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "DATABASE_PATH=/app/data/euroleague-claw.db" `
        --output none

    # Use YAML for volume mount and health probes
    $yamlContent = @"
properties:
  template:
    volumes:
      - name: botdata
        storageName: botdata
        storageType: AzureFile
    containers:
      - name: $ContainerAppName
        image: $AcrLoginServer/${ImageName}:latest
        resources:
          cpu: 0.25
          memory: 0.5Gi
        volumeMounts:
          - volumeName: botdata
            mountPath: /app/data
        probes:
          - type: Liveness
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
            failureThreshold: 3
          - type: Startup
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 10
"@

    $tempYaml = [System.IO.Path]::GetTempFileName() + ".yaml"
    try {
        $yamlContent | Out-File -FilePath $tempYaml -Encoding utf8
        az containerapp revision copy `
            --name $ContainerAppName `
            --resource-group $ResourceGroup `
            --yaml $tempYaml `
            --output none
    } finally {
        Remove-Item -Path $tempYaml -ErrorAction SilentlyContinue
    }
    Write-Ok "Volume mounted and health probes configured"
}

# ---------------------------------------------------------------------------
# 8. Create Service Principal for GitHub Actions
# ---------------------------------------------------------------------------
Write-Info "Creating service principal for GitHub Actions"
$SubscriptionId = az account show --query id --output tsv
if ($LASTEXITCODE -ne 0) { throw "Failed to get subscription ID" }

$SpJson = $null
try {
    $SpJson = az ad sp create-for-rbac `
        --name "github-euroleague-claw" `
        --role contributor `
        --scopes "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup" `
        --sdk-auth
} catch {
    # Service principal may already exist
}

# Grant ACR push access
if ($SpJson) {
    $SpAppId = ($SpJson | ConvertFrom-Json).clientId
    $AcrId = az acr show --name $AcrName --resource-group $ResourceGroup --query id --output tsv

    if ($SpAppId) {
        try {
            az role assignment create `
                --assignee $SpAppId `
                --role AcrPush `
                --scope $AcrId `
                --output none 2>$null
        } catch {
            # Role assignment may already exist
        }
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host " Setup Complete!" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Resource Group:    $ResourceGroup"
Write-Host " ACR:               $AcrLoginServer"
Write-Host " Container App:     $ContainerAppName"
Write-Host " Storage Account:   $StorageAccount"
Write-Host " File Share:        $FileShareName"
Write-Host ""
Write-Host " --- GitHub Actions Secrets ------------------------------------------------" -ForegroundColor Yellow
Write-Host ""
Write-Host " Add these secrets to your GitHub repo ($GitHubRepo):"
Write-Host ""
Write-Host " 1. AZURE_CREDENTIALS — paste the JSON below:"
Write-Host ""
if ($SpJson) {
    Write-Host ($SpJson -join "`n")
} else {
    Write-Host "  (Service principal already existed — retrieve credentials from Azure Portal"
    Write-Host "   or delete and re-create: az ad sp delete --id github-euroleague-claw)"
}
Write-Host ""
Write-Host " 2. REGISTRY_NAME = $AcrName"
Write-Host ""
Write-Host " --- Next Steps ------------------------------------------------------------" -ForegroundColor Yellow
Write-Host ""
Write-Host " 1. Add the GitHub secrets above to: https://github.com/$GitHubRepo/settings/secrets/actions"
Write-Host " 2. Update Container App secrets with real values:"
Write-Host "      az containerapp secret set --name $ContainerAppName --resource-group $ResourceGroup ``"
Write-Host "        --secrets telegram-bot-token=<YOUR_TOKEN> dunkest-bearer-token=<YOUR_TOKEN>"
Write-Host " 3. Set TELEGRAM_ALLOWED_CHAT_IDS and DUNKEST_FANTASY_TEAM_IDS env vars:"
Write-Host "      az containerapp update --name $ContainerAppName --resource-group $ResourceGroup ``"
Write-Host "        --set-env-vars 'TELEGRAM_ALLOWED_CHAT_IDS=<id1,id2>' 'DUNKEST_FANTASY_TEAM_IDS=<id1,id2>'"
Write-Host " 4. Push to main to trigger the first deployment!"
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
