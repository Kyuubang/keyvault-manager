import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

export const SCOPES = {
  arm: ["https://management.azure.com/user_impersonation"],
  kv: ["https://vault.azure.net/user_impersonation"],
  la: ["https://api.loganalytics.io/Data.Read"],
  graph: ["User.Read"],
} as const;
export type Resource = keyof typeof SCOPES;

let pca: PublicClientApplication;

export async function initAuth(): Promise<AccountInfo | null> {
  const res = await fetch("/api/config");
  const { clientId, tenantId } = await res.json();
  if (!clientId) throw new Error("The server is missing AZURE_CLIENT_ID. Set it and restart.");
  pca = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId || "organizations"}`,
      redirectUri: `${window.location.origin}/redirect.html`,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  const account = result?.account ?? pca.getAllAccounts()[0] ?? null;
  if (account) pca.setActiveAccount(account);
  return account;
}

export function signIn() {
  return pca.loginRedirect({
    scopes: [...SCOPES.arm],
    extraScopesToConsent: [...SCOPES.kv, ...SCOPES.la, ...SCOPES.graph],
    redirectStartPage: window.location.href,
  });
}

export function signOut() {
  return pca.logoutRedirect({ account: pca.getActiveAccount() });
}

export async function getToken(resource: Resource): Promise<string> {
  const account = pca.getActiveAccount();
  if (!account) throw new Error("Not signed in");
  const request = { account, scopes: [...SCOPES[resource]] };
  try {
    return (await pca.acquireTokenSilent(request)).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ ...request, redirectStartPage: window.location.href });
      return new Promise(() => {});
    }
    throw e;
  }
}

export const currentUsername = () => pca.getActiveAccount()?.username ?? "";
