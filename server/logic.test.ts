import { describe, expect, it } from "vitest";
import { actionMatches, accessPolicyAllowsWrite, rbacAllowsWrite } from "./permissions.js";
import { isSecretName, isVaultName, isVersion, parseVaultResourceId } from "./validate.js";
import { buildAuditQuery } from "./audit.js";

const SET = "Microsoft.KeyVault/vaults/secrets/setSecret/action";

describe("actionMatches", () => {
  it("matches exact and case-insensitive", () => {
    expect(actionMatches(SET, SET)).toBe(true);
    expect(actionMatches(SET.toLowerCase(), SET)).toBe(true);
  });
  it("supports wildcards", () => {
    expect(actionMatches("*", SET)).toBe(true);
    expect(actionMatches("Microsoft.KeyVault/vaults/secrets/*", SET)).toBe(true);
    expect(actionMatches("Microsoft.KeyVault/vaults/secrets/*/action", SET)).toBe(true);
    expect(actionMatches("Microsoft.KeyVault/vaults/keys/*", SET)).toBe(false);
    expect(actionMatches("Microsoft.KeyVault/vaults/secrets/getSecret/action", SET)).toBe(false);
  });
  it("does not treat regex metacharacters as special", () => {
    expect(actionMatches("Microsoft.KeyVault/vaults/secrets/setSecret/actio.", SET)).toBe(false);
  });
});

describe("rbacAllowsWrite", () => {
  it("is true when a dataAction grants and nothing denies", () => {
    expect(rbacAllowsWrite([{ actions: [], notActions: [], dataActions: ["Microsoft.KeyVault/vaults/secrets/*"], notDataActions: [] }])).toBe(true);
  });
  it("respects notDataActions within the same permission", () => {
    expect(
      rbacAllowsWrite([{ dataActions: ["Microsoft.KeyVault/vaults/*"], notDataActions: ["Microsoft.KeyVault/vaults/secrets/setSecret/action"] }])
    ).toBe(false);
  });
  it("allows when another permission grants it", () => {
    expect(
      rbacAllowsWrite([
        { dataActions: ["Microsoft.KeyVault/vaults/*"], notDataActions: [SET] },
        { dataActions: [SET] },
      ])
    ).toBe(true);
  });
  it("ignores control-plane actions", () => {
    expect(rbacAllowsWrite([{ actions: ["*"] }])).toBe(false);
    expect(rbacAllowsWrite([])).toBe(false);
  });
});

describe("accessPolicyAllowsWrite", () => {
  const policies = [
    { objectId: "user-1", permissions: { secrets: ["Get", "List"] } },
    { objectId: "group-1", permissions: { secrets: ["get", "set"] } },
    { objectId: "user-2", permissions: { secrets: ["all"] } },
  ];
  it("matches user or group ids with set/all", () => {
    expect(accessPolicyAllowsWrite(policies, ["user-1"])).toBe(false);
    expect(accessPolicyAllowsWrite(policies, ["user-1", "GROUP-1"])).toBe(true);
    expect(accessPolicyAllowsWrite(policies, ["user-2"])).toBe(true);
    expect(accessPolicyAllowsWrite(undefined, ["user-2"])).toBe(false);
  });
});

describe("validation", () => {
  it("validates vault names", () => {
    expect(isVaultName("my-vault-01")).toBe(true);
    expect(isVaultName("ab")).toBe(false);
    expect(isVaultName("evil.com/x")).toBe(false);
    expect(isVaultName("a".repeat(25))).toBe(false);
  });
  it("validates secret names", () => {
    expect(isSecretName("Db-Password")).toBe(true);
    expect(isSecretName("a/b")).toBe(false);
    expect(isSecretName("")).toBe(false);
    expect(isSecretName("a".repeat(128))).toBe(false);
  });
  it("validates versions", () => {
    expect(isVersion("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isVersion("../x")).toBe(false);
  });
  it("parses vault resource ids", () => {
    const id = "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-1/providers/Microsoft.KeyVault/vaults/kv-1";
    expect(parseVaultResourceId(id)).toEqual({ subscriptionId: "11111111-2222-3333-4444-555555555555", resourceGroup: "rg-1", name: "kv-1" });
    expect(parseVaultResourceId(id + "/../x")).toBeNull();
    expect(parseVaultResourceId("/subscriptions/x/resourceGroups/rg/providers/Microsoft.Web/sites/a")).toBeNull();
  });
});

describe("buildAuditQuery", () => {
  it("filters by secret when given", () => {
    const q = buildAuditQuery("db-pass");
    expect(q).toContain("AZKVAuditLogs");
    expect(q).toContain("AzureDiagnostics");
    expect(q).toContain("/secrets/db-pass");
  });
  it("has no secret filter for whole-vault queries", () => {
    expect(buildAuditQuery()).not.toContain("/secrets/");
  });
  it("rejects invalid secret names", () => {
    expect(() => buildAuditQuery('x" | evil')).toThrow();
  });
});
