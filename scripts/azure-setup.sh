#!/usr/bin/env bash
# =============================================================================
# Azure Setup Script for EuroleagueClaw
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
#   chmod +x scripts/azure-setup.sh
#   ./scripts/azure-setup.sh
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Subscription selected (az account set --subscription <id>)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — customize these values
# ---------------------------------------------------------------------------
RESOURCE_GROUP="euroleague-claw-rg"
LOCATION="westeurope"
ACR_NAME="euroleagueclawacr"          # Must be globally unique, alphanumeric only
STORAGE_ACCOUNT="euroleagueclawsa"    # Must be globally unique, alphanumeric only
FILE_SHARE_NAME="euroleague-claw-data"
CONTAINER_APP_ENV="euroleague-claw-env"
CONTAINER_APP_NAME="euroleague-claw"
IMAGE_NAME="euroleague-claw"

# GitHub repo for service principal RBAC scope (format: owner/repo)
GITHUB_REPO="filip998/EuroleagueClaw"

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
info() { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "  \033[1;32m✓ $*\033[0m"; }

# ---------------------------------------------------------------------------
# 1. Resource Group
# ---------------------------------------------------------------------------
info "Creating resource group: $RESOURCE_GROUP"
if az group show --name "$RESOURCE_GROUP" &>/dev/null; then
  ok "Already exists"
else
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
  ok "Created"
fi

# ---------------------------------------------------------------------------
# 2. Azure Container Registry (Basic tier)
# ---------------------------------------------------------------------------
info "Creating container registry: $ACR_NAME"
if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "Already exists"
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Basic \
    --admin-enabled true \
    --output none
  ok "Created"
fi

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer --output tsv)

# ---------------------------------------------------------------------------
# 3. Storage Account + File Share (SQLite persistence)
# ---------------------------------------------------------------------------
info "Creating storage account: $STORAGE_ACCOUNT"
if az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "Already exists"
else
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --output none
  ok "Created"
fi

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[0].value" --output tsv)

info "Creating file share: $FILE_SHARE_NAME"
if az storage share show --name "$FILE_SHARE_NAME" --account-name "$STORAGE_ACCOUNT" --account-key "$STORAGE_KEY" &>/dev/null; then
  ok "Already exists"
else
  az storage share create \
    --name "$FILE_SHARE_NAME" \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --quota 1 \
    --output none
  ok "Created"
fi

# ---------------------------------------------------------------------------
# 4. Container Apps Environment
# ---------------------------------------------------------------------------
info "Creating Container Apps environment: $CONTAINER_APP_ENV"
if az containerapp env show --name "$CONTAINER_APP_ENV" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "Already exists"
else
  az containerapp env create \
    --name "$CONTAINER_APP_ENV" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none
  ok "Created"
fi

# ---------------------------------------------------------------------------
# 5. Link Azure Files storage to the environment
# ---------------------------------------------------------------------------
info "Linking Azure Files to Container Apps environment"
EXISTING_STORAGE=$(az containerapp env storage show \
  --name "$CONTAINER_APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-name "botdata" 2>/dev/null || true)

if [ -n "$EXISTING_STORAGE" ]; then
  ok "Storage link already exists"
else
  az containerapp env storage set \
    --name "$CONTAINER_APP_ENV" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-name "botdata" \
    --azure-file-account-name "$STORAGE_ACCOUNT" \
    --azure-file-account-key "$STORAGE_KEY" \
    --azure-file-share-name "$FILE_SHARE_NAME" \
    --access-mode ReadWrite \
    --output none
  ok "Linked"
fi

# ---------------------------------------------------------------------------
# 6. Build and push initial image
# ---------------------------------------------------------------------------
info "Building and pushing initial image to ACR"
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE_NAME:latest" \
  . \
  --output none
ok "Image pushed to $ACR_LOGIN_SERVER/$IMAGE_NAME:latest"

# ---------------------------------------------------------------------------
# 7. Create the Container App
# ---------------------------------------------------------------------------
info "Creating Container App: $CONTAINER_APP_NAME"
if az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "Already exists — updating image"
  az containerapp update \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
    --output none
else
  az containerapp create \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$CONTAINER_APP_ENV" \
    --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
    --registry-server "$ACR_LOGIN_SERVER" \
    --registry-username "$ACR_NAME" \
    --registry-password "$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" --output tsv)" \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --ingress external \
    --target-port 8080 \
    --secrets \
      "telegram-bot-token=REPLACE_WITH_YOUR_TELEGRAM_BOT_TOKEN" \
      "dunkest-bearer-token=REPLACE_WITH_YOUR_DUNKEST_BEARER_TOKEN" \
    --env-vars \
      "TELEGRAM_BOT_TOKEN=secretref:telegram-bot-token" \
      "TELEGRAM_ALLOWED_CHAT_IDS=" \
      "DUNKEST_BEARER_TOKEN=secretref:dunkest-bearer-token" \
      "DUNKEST_FANTASY_TEAM_IDS=" \
      "EUROLEAGUE_SEASON_CODE=E2025" \
      "EUROLEAGUE_COMPETITION_CODE=E" \
      "EUROLEAGUE_POLL_INTERVAL_MS=10000" \
      "LOG_LEVEL=info" \
      "NODE_ENV=production" \
      "DATABASE_PATH=/app/data/euroleague-claw.db" \
      "HEALTH_PORT=8080" \
      "THROTTLE_WINDOW_SECONDS=120" \
      "THROTTLE_MAX_MESSAGES_PER_MINUTE=5" \
    --output none
  ok "Created"

  # Add volume mount (must be done after creation)
  info "Attaching Azure Files volume to container"
  az containerapp update \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars "DATABASE_PATH=/app/data/euroleague-claw.db" \
    --output none

  # Use ARM template patch for volume mount (az containerapp doesn't support --volume directly in all versions)
  az containerapp revision copy \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml /dev/stdin <<EOF
properties:
  template:
    volumes:
      - name: botdata
        storageName: botdata
        storageType: AzureFile
    containers:
      - name: $CONTAINER_APP_NAME
        image: $ACR_LOGIN_SERVER/$IMAGE_NAME:latest
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
EOF
  ok "Volume mounted and health probes configured"
fi

# ---------------------------------------------------------------------------
# 8. Create Service Principal for GitHub Actions
# ---------------------------------------------------------------------------
info "Creating service principal for GitHub Actions"
SUBSCRIPTION_ID=$(az account show --query id --output tsv)

SP_JSON=$(az ad sp create-for-rbac \
  --name "github-euroleague-claw" \
  --role contributor \
  --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \
  --sdk-auth 2>/dev/null || true)

# Grant ACR push access
SP_APP_ID=$(echo "$SP_JSON" | grep -o '"clientId": "[^"]*"' | cut -d'"' -f4)
ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id --output tsv)

if [ -n "$SP_APP_ID" ]; then
  az role assignment create \
    --assignee "$SP_APP_ID" \
    --role AcrPush \
    --scope "$ACR_ID" \
    --output none 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo " Setup Complete!"
echo "============================================================================="
echo ""
echo " Resource Group:    $RESOURCE_GROUP"
echo " ACR:               $ACR_LOGIN_SERVER"
echo " Container App:     $CONTAINER_APP_NAME"
echo " Storage Account:   $STORAGE_ACCOUNT"
echo " File Share:        $FILE_SHARE_NAME"
echo ""
echo " ─── GitHub Actions Secrets ───────────────────────────────────────────────"
echo ""
echo " Add these secrets to your GitHub repo ($GITHUB_REPO):"
echo ""
echo " 1. AZURE_CREDENTIALS — paste the JSON below:"
echo ""
if [ -n "${SP_JSON:-}" ]; then
  echo "$SP_JSON"
else
  echo "  (Service principal already existed — retrieve credentials from Azure Portal"
  echo "   or delete and re-create: az ad sp delete --id github-euroleague-claw)"
fi
echo ""
echo " 2. REGISTRY_NAME = $ACR_NAME"
echo ""
echo " ─── Next Steps ───────────────────────────────────────────────────────────"
echo ""
echo " 1. Add the GitHub secrets above to: https://github.com/$GITHUB_REPO/settings/secrets/actions"
echo " 2. Update Container App secrets with real values:"
echo "      az containerapp secret set --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP \\"
echo "        --secrets telegram-bot-token=<YOUR_TOKEN> dunkest-bearer-token=<YOUR_TOKEN>"
echo " 3. Set TELEGRAM_ALLOWED_CHAT_IDS and DUNKEST_FANTASY_TEAM_IDS env vars:"
echo "      az containerapp update --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP \\"
echo "        --set-env-vars 'TELEGRAM_ALLOWED_CHAT_IDS=<id1,id2>' 'DUNKEST_FANTASY_TEAM_IDS=<id1,id2>'"
echo " 4. Push to main to trigger the first deployment!"
echo ""
echo "============================================================================="
