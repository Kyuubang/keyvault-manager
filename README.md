# Key Vault Manager

A small, stateless web app for editing Azure Key Vault secrets safely.

- **Multi-line editor** (Monaco) that opens the latest version of a secret by default.
- **Review before save**: every save shows a diff against the current latest version, then writes a new version.
- **Compare with any version**: diff your draft against any previous version while you keep editing.
- **Browse history**: open any previous version, and restore it by saving it as the new latest.
- **Activity**: secret access audit from Log Analytics (who read or changed what, from where, and denied attempts), plus vault changes from the Azure Activity Log.
- **Only writable vaults**: the vault list shows only vaults where you can set secrets (RBAC `setSecret` data action, or a `set` access policy).
- **Conflict protection**: if someone else saved a newer version while you were editing, the save is blocked and you are asked to review again.

## How it works

There is no database and no stored state. You sign in with Entra ID (Azure AD SSO) in the browser, and the SPA gets *delegated* tokens for you. A thin Node server forwards each request, with your tokens, to Azure:

| Purpose | Azure API | Token scope |
| --- | --- | --- |
| Find vaults and check your permissions | Resource Graph, `Microsoft.Authorization/permissions` | `https://management.azure.com/user_impersonation` |
| Read and write secrets and versions | Key Vault data plane (api-version 7.5) | `https://vault.azure.net/user_impersonation` |
| Secret access audit | Log Analytics query API (resource-centric) | `https://api.loganalytics.io/Data.Read` |
| Group membership for access policies | Microsoft Graph `/me/getMemberObjects` | `User.Read` |
| Vault changes | Azure Activity Log | ARM token |

The server exists because the Key Vault data plane does not allow browser CORS. It has no credentials of its own, so Azure applies your own permissions to every call. It validates vault, secret and version names, which prevents requests to arbitrary hosts. It also sends `Cache-Control: no-store` on all API responses.

## 1. Create the app registration

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

## 2. What users need in Azure

- **To edit a vault**: *Key Vault Secrets Officer* (RBAC vaults), or an access policy with secret `Get`, `List` and `Set` (access-policy vaults). Group-based access policies are supported.
- **To find vaults**: *Reader* on the vault, resource group or subscription.
- **For the secret access audit**: the vault needs a diagnostic setting that sends `AuditEvent` logs to a Log Analytics workspace, and the user needs read access to those logs (for example *Log Analytics Reader*, or *Reader* on the vault when the workspace uses resource-context access). Without these, the Activity tab explains what is missing and still shows vault changes.

## 3. Run

```bash
cp .env.example .env      # set AZURE_CLIENT_ID and AZURE_TENANT_ID
npm install
npm run dev               # web on http://localhost:5173, API on :8080
```

Production:

```bash
npm run build
npm start                 # serves the SPA and API on $PORT (default 8080)
```

Or use Docker:

```bash
docker build -t keyvault-manager .
docker run -p 8080:8080 -e AZURE_CLIENT_ID=... -e AZURE_TENANT_ID=... keyvault-manager
```

Serve it over HTTPS, and register `https://YOUR-HOST/redirect.html` as a SPA redirect URI. The server can run as many instances as you like because it keeps no state; App Service or Container Apps both work.

## Development

```bash
npm test           # server unit and route tests (mocked Azure)
npm run typecheck
```

## Troubleshooting sign-in

- **AADSTS9002326** ("Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type"): the redirect URI is registered under the **Web** platform instead of **Single-page application**. Move it:
  ```bash
  az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications(appId='$APP_ID')" \
    --headers "Content-Type=application/json" \
    --body '{"web":{"redirectUris":[]},"spa":{"redirectUris":["http://localhost:5173/redirect.html"]}}'
  ```
- **AADSTS50011** (redirect URI mismatch): register `<origin>/redirect.html` exactly, including the port.
- **AADSTS65001 / consent required**: your tenant blocks user consent. An admin must run `az ad app permission admin-consent --id $APP_ID`.

## Notes and limits

- Azure public cloud only (`*.vault.azure.net`).
- Secret values are limited to 25,000 characters (the Key Vault limit is 25 KB).
- Saving always creates a new version and copies tags from the latest version. The new version is enabled and has no expiry or activation date; set those in the Azure portal if you need them.
- Deleting secrets is intentionally not supported.
- Secrets managed by Key Vault certificates are hidden.
