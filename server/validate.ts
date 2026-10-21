const VAULT_NAME = /^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/;
const SECRET_NAME = /^[0-9a-zA-Z-]{1,127}$/;
const VERSION = /^[0-9a-fA-F]{32}$/;
const VAULT_ID =
  /^\/subscriptions\/([0-9a-fA-F-]{36})\/resourceGroups\/([-\w._()]{1,90})\/providers\/Microsoft\.KeyVault\/vaults\/([a-zA-Z0-9-]{3,24})$/i;

export const isVaultName = (v: unknown): v is string => typeof v === "string" && VAULT_NAME.test(v);
export const isSecretName = (v: unknown): v is string => typeof v === "string" && SECRET_NAME.test(v);
export const isVersion = (v: unknown): v is string => typeof v === "string" && VERSION.test(v);

export function parseVaultResourceId(id: unknown) {
  if (typeof id !== "string") return null;
  const m = VAULT_ID.exec(id);
  if (!m || m[2].includes("..") || !isVaultName(m[3])) return null;
  return { subscriptionId: m[1], resourceGroup: m[2], name: m[3] };
}

export const vaultHost = (name: string) => `https://${name.toLowerCase()}.vault.azure.net`;
