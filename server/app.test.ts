import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const SUB = "11111111-2222-3333-4444-555555555555";
const vaultId = (n: string) => `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/${n}`;
const armToken = `x.${Buffer.from(JSON.stringify({ oid: "user-oid" })).toString("base64url")}.y`;

type Handler = (url: string, init?: RequestInit) => unknown;
function fakeFetch(routes: [RegExp, Handler][]) {
  return vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response(JSON.stringify({ error: { code: "NotFound", message: `no route ${url}` } }), { status: 404 });
    const out = hit[1](url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("GET /api/vaults", () => {
  it("returns only vaults the user can write secrets to", async () => {
    const f = fakeFetch([
      [
        /ResourceGraph/,
        () => ({
          data: [
            { id: vaultId("kv-rbac-ok"), name: "kv-rbac-ok", rbac: true, subscriptionId: SUB, resourceGroup: "rg", location: "x" },
            { id: vaultId("kv-rbac-read"), name: "kv-rbac-read", rbac: true, subscriptionId: SUB, resourceGroup: "rg", location: "x" },
            {
              id: vaultId("kv-ap-group"), name: "kv-ap-group", rbac: false, subscriptionId: SUB, resourceGroup: "rg", location: "x",
              accessPolicies: [{ objectId: "group-1", permissions: { secrets: ["Set"] } }],
            },
            {
              id: vaultId("kv-ap-none"), name: "kv-ap-none", rbac: false, subscriptionId: SUB, resourceGroup: "rg", location: "x",
              accessPolicies: [{ objectId: "someone", permissions: { secrets: ["all"] } }],
            },
          ],
        }),
      ],
      [/kv-rbac-ok\/providers\/Microsoft.Authorization\/permissions/, () => ({ value: [{ dataActions: ["Microsoft.KeyVault/vaults/secrets/*"] }] })],
      [/kv-rbac-read\/providers\/Microsoft.Authorization\/permissions/, () => ({ value: [{ dataActions: ["Microsoft.KeyVault/vaults/secrets/getSecret/action"] }] })],
      [/getMemberObjects/, () => ({ value: ["group-1"] })],
    ]);
    const res = await request(createApp({ fetch: f }))
      .get("/api/vaults")
      .set("Authorization", `Bearer ${armToken}`)
      .set("x-graph-token", "g");
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.name)).toEqual(["kv-ap-group", "kv-rbac-ok"]);
    expect(res.body[1].accessPolicies).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("requires a token", async () => {
    const res = await request(createApp({ fetch: fakeFetch([]) })).get("/api/vaults");
    expect(res.status).toBe(401);
  });
});

describe("secrets routes", () => {
  it("rejects invalid vault names (no SSRF)", async () => {
    const f = fakeFetch([]);
    const res = await request(createApp({ fetch: f })).get("/api/vaults/evil.com%2Fx/secrets").set("x-kv-token", "t");
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("gets the latest secret value by default", async () => {
    const f = fakeFetch([
      [/kv-1\.vault\.azure\.net\/secrets\/db\/\?/, () => ({ id: "https://kv-1.vault.azure.net/secrets/db/abc", value: "a\nb", attributes: { enabled: true, created: 1700000000 } })],
    ]);
    const res = await request(createApp({ fetch: f })).get("/api/vaults/kv-1/secrets/db").set("x-kv-token", "t");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "db", version: "abc", value: "a\nb", enabled: true });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer t" });
  });

  it("rejects bad versions", async () => {
    const res = await request(createApp({ fetch: fakeFetch([]) })).get("/api/vaults/kv-1/secrets/db?version=../../x").set("x-kv-token", "t");
    expect(res.status).toBe(400);
  });

  it("lists versions newest first", async () => {
    const f = fakeFetch([
      [
        /secrets\/db\/versions/,
        () => ({
          value: [
            { id: "https://kv-1.vault.azure.net/secrets/db/old", attributes: { created: 1 } },
            { id: "https://kv-1.vault.azure.net/secrets/db/new", attributes: { created: 2 } },
          ],
          nextLink: null,
        }),
      ],
    ]);
    const res = await request(createApp({ fetch: f })).get("/api/vaults/kv-1/secrets/db/versions").set("x-kv-token", "t");
    expect(res.body.map((v: any) => v.version)).toEqual(["new", "old"]);
  });

  it("refuses nextLinks pointing at another host", async () => {
    const f = fakeFetch([[/kv-1.*secrets\?/, () => ({ value: [], nextLink: "https://evil.example.com/x" })]]);
    const res = await request(createApp({ fetch: f })).get("/api/vaults/kv-1/secrets").set("x-kv-token", "t");
    expect(res.status).toBe(502);
  });

  it("saves a new version, passing contentType and tags", async () => {
    const f = fakeFetch([[/secrets\/db\?/, () => ({ id: "https://kv-1.vault.azure.net/secrets/db/v2", contentType: "text/plain", attributes: {} })]]);
    const res = await request(createApp({ fetch: f }))
      .put("/api/vaults/kv-1/secrets/db")
      .set("x-kv-token", "t")
      .send({ value: "line1\r\nline2\n", contentType: "text/plain", tags: { owner: "me" } });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("v2");
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ value: "line1\r\nline2\n", contentType: "text/plain", tags: { owner: "me" } });
  });

  it("propagates Azure errors", async () => {
    const f = fakeFetch([
      [/secrets\/db\//, () => new Response(JSON.stringify({ error: { code: "Forbidden", message: "Caller is not authorized" } }), { status: 403 })],
    ]);
    const res = await request(createApp({ fetch: f })).get("/api/vaults/kv-1/secrets/db").set("x-kv-token", "t");
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: "Forbidden", message: "Caller is not authorized" });
  });
});

describe("audit routes", () => {
  it("queries log analytics against the vault resource", async () => {
    const f = fakeFetch([
      [/api\.loganalytics\.io\/v1\/subscriptions\/.*\/vaults\/kv-1\/query/, () => ({
        tables: [{ columns: [{ name: "OperationName" }, { name: "Caller" }], rows: [["SecretSet", "me@x.com"]] }],
      })],
    ]);
    const res = await request(createApp({ fetch: f }))
      .post("/api/audit")
      .send({ resourceId: vaultId("kv-1"), secretName: "db", days: 30 })
      .set("x-la-token", "t");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ OperationName: "SecretSet", Caller: "me@x.com" }]);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.timespan).toBe("P30D");
    expect(body.query).toContain("/secrets/db");
  });

  it("rejects non-vault resource ids", async () => {
    const res = await request(createApp({ fetch: fakeFetch([]) }))
      .post("/api/audit")
      .send({ resourceId: "/subscriptions/x/whatever" })
      .set("x-la-token", "t");
    expect(res.status).toBe(400);
  });

  it("reads the activity log", async () => {
    const f = fakeFetch([
      [/eventtypes\/management\/values/, () => ({
        value: [{ eventTimestamp: "2026-01-01T00:00:00Z", operationName: { localizedValue: "Update Key Vault" }, status: { localizedValue: "Succeeded" }, caller: "me@x.com" }],
      })],
    ]);
    const res = await request(createApp({ fetch: f }))
      .get(`/api/activity?resourceId=${encodeURIComponent(vaultId("kv-1"))}&days=7`)
      .set("Authorization", `Bearer ${armToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ operation: "Update Key Vault", status: "Succeeded", caller: "me@x.com" });
  });
});
