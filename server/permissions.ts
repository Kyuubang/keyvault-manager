export const SET_SECRET_ACTION = "Microsoft.KeyVault/vaults/secrets/setSecret/action";

export interface RbacPermission {
  actions?: string[];
  notActions?: string[];
  dataActions?: string[];
  notDataActions?: string[];
}

export interface AccessPolicy {
  objectId?: string;
  permissions?: { secrets?: string[] };
}

export function actionMatches(pattern: string, action: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(action);
}

export function rbacAllowsWrite(permissions: RbacPermission[], action = SET_SECRET_ACTION): boolean {
  return permissions.some(
    (p) =>
      (p.dataActions ?? []).some((a) => actionMatches(a, action)) &&
      !(p.notDataActions ?? []).some((a) => actionMatches(a, action))
  );
}

export function accessPolicyAllowsWrite(policies: AccessPolicy[] | undefined, objectIds: string[]): boolean {
  const ids = new Set(objectIds.map((id) => id.toLowerCase()));
  return (policies ?? []).some(
    (p) =>
      !!p.objectId &&
      ids.has(p.objectId.toLowerCase()) &&
      (p.permissions?.secrets ?? []).some((s) => ["set", "all"].includes(s.toLowerCase()))
  );
}
