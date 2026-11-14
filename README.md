
# Key Vault Manager

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

A small, stateless web UI for safely editing secrets in **Azure Key Vault** — with diff-before-save, version history, and a full access audit trail.

No database. No stored credentials. Every action runs under the signed-in user's own Azure permissions.

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Required Azure permissions](#required-azure-permissions)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Contributing](#contributing)
- [License](#license)

## Features

- 📝 **Monaco editor** — opens the latest version of a secret, with full syntax support.
- 🔍 **Review before save** — every save shows a diff against the current latest version before writing a new one.
- 🔀 **Compare any version** — diff your draft against any previous version while you keep editing.
- 🕘 **Version history** — browse previous versions, see who saved each one, and restore any of them as the new latest.
- 📊 **Activity audit** — secret access history from Log Analytics (who read/changed what, from where, and denied attempts), plus vault-level changes from the Azure Activity Log.
- 🔐 **Scoped visibility** — the vault list shows only vaults you can actually write to (RBAC `setSecret`, or a `set` access policy).
- ⚠️ **Conflict protection** — if someone else saved a newer version while you were editing, your save is blocked until you review again.

## How it works

You sign in with Entra ID (Azure AD SSO) in the browser; the SPA obtains **delegated** tokens for you. A thin Node server forwards each request — with your own tokens — to Azure. It holds no credentials of its own, so every call runs under your permissions.

| Purpose | Azure API | Token scope |
| --- | --- | --- |
| Find vaults and check your permissions | Resource Graph, `Microsoft.Authorization/permissions` | `https://management.azure.com/user_impersonation` |
| Read and write secrets and versions | Key Vault data plane (api-version 7.5) | `https://vault.azure.net/user_impersonation` |
| Secret access audit | Log Analytics query API (resource-centric) | `https://api.loganalytics.io/Data.Read` |
| Group membership for access policies | Microsoft Graph `/me/getMemberObjects` | `User.Read` |
| Vault changes | Azure Activity Log | ARM token |

The server exists only because the Key Vault data plane does not allow browser CORS. It validates vault, secret and version names (no arbitrary-host requests) and sends `Cache-Control: no-store` on every API response.

## Quick start

```bash
cp .env.example .env      # set AZURE_CLIENT_ID and AZURE_TENANT_ID
npm install
npm run dev               # web on http://localhost:5173, API on :8080
```

See [Create the app registration](#1-app-registration-one-time) below before your first sign-in.

### 1. App registration (one-time)

```bash
APP_ID=$(az ad app create --display-name "Key Vault Manager" --sign-in-audience AzureADMyOrg --query appId -o tsv)

# SPA redirect URIs (MSAL uses a small redirect bridge page)
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications(appId='$APP_ID')" \
  --headers "Content-Type=application/json" \
  --body '{"spa":{"redirectUris":["http://localhost:5173/redirect.html","https://YOUR-HOST/redirect.html"]}}'

# Delegated permissions
scope_id() { az ad sp show --id "$1" --query "oauth2PermissionScopes[?value=='$2'].id" -o tsv; }
az ad app permission add --id $APP_ID --api 797f4846-ba00-4fd7-ba43-dac1f8f63013 --api-permissions "$(scope_id 797f4846-ba00-4fd7-ba43-dac1f8f63013 user_impersonation)=Scope"  # Azure Service Management
az ad app permission add --id $APP_ID --api cfa8b339-82a2-471a-a3c9-0fc0be7a4093 --api-permissions "$(scope_id cfa8b339-82a2-471a-a3c9-0fc0be7a4093 user_impersonation)=Scope"  # Azure Key Vault
az ad app permission add --id $APP_ID --api ca7f3f0b-7d91-482c-8e09-c5d840d0eac5 --api-permissions "$(scope_id ca7f3f0b-7d91-482c-8e09-c5d840d0eac5 Data.Read)=Scope"           # Log Analytics API
az ad app permission add --id $APP_ID --api 00000003-0000-0000-c000-000000000000 --api-permissions "$(scope_id 00000003-0000-0000-c000-000000000000 User.Read)=Scope"           # Microsoft Graph

# Optional: grant admin consent so users are not prompted
az ad app permission admin-consent --id $APP_ID
echo "AZURE_CLIENT_ID=$APP_ID"; az account show --query "'AZURE_TENANT_ID=' + tenantId" -o tsv
```

No client secret is needed.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | yes | App registration (SPA) client ID |
| `AZURE_TENANT_ID` | yes | Entra ID tenant ID |
| `PORT` | no | API/web server port (default `8080`) |

## Deployment

### Docker

```bash
docker build -t keyvault-manager .
docker run -p 8080:8080 -e AZURE_CLIENT_ID=... -e AZURE_TENANT_ID=... keyvault-manager
```

### Kubernetes

Manifests are in [`k8s/`](k8s/) (Deployment, Service, ConfigMap, and a Traefik `IngressRoute`):

```bash
kubectl apply -k k8s/
```

Set real values for `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` in `k8s/configmap.yaml` and adjust the `Host()` rule in `k8s/ingressroute.yaml` for your domain.

> Serve it over HTTPS and register `https://YOUR-HOST/redirect.html` as a SPA redirect URI. The server keeps no state, so it scales horizontally without restriction.

## Required Azure permissions

| Capability | Requirement |
| --- | --- |
| Edit a vault | *Key Vault Secrets Officer* (RBAC), or an access policy with `Get`, `List`, `Set` (access-policy vaults, incl. group-based) |
| Discover vaults | *Reader* on the vault, resource group, or subscription |
| Secret access audit | Vault must ship `AuditEvent` logs to a Log Analytics workspace, and the user needs read access to that workspace (e.g. *Log Analytics Reader*, or *Reader* on the vault for resource-context workspaces) |

Without audit permissions, the Activity tab still shows vault changes and explains what's missing.

## Development

```bash
npm test           # server unit and route tests (mocked Azure)
npm run typecheck
```

## Troubleshooting

| Error | Cause | Fix |
| --- | --- | --- |
| `AADSTS9002326` | Redirect URI registered under **Web** instead of **Single-page application** | Move it to `spa.redirectUris` (see snippet below) |
| `AADSTS50011` | Redirect URI mismatch | Register `<origin>/redirect.html` exactly, including the port |
| `AADSTS65001` | Tenant blocks user consent | An admin runs `az ad app permission admin-consent --id $APP_ID` |

```bash
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications(appId='$APP_ID')" \
  --headers "Content-Type=application/json" \
  --body '{"web":{"redirectUris":[]},"spa":{"redirectUris":["http://localhost:5173/redirect.html"]}}'
```

## Limits

- Azure public cloud only (`*.vault.azure.net`).
- Secret values are limited to 25,000 characters (Key Vault's own limit is 25 KB).
- Saving always creates a new version, copying tags from the latest version; the new version is enabled with no expiry/activation date (set those in the Azure portal if needed).
- Deleting secrets is intentionally unsupported.
- Secrets managed by Key Vault certificates are hidden.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run typecheck` before submitting.

## License

[MIT](LICENSE)

## Maintainer

Ahmad Bayhaqi — ahmad.bayhaqi@nawatech.co
