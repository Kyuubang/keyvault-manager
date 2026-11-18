import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { accessPolicyAllowsWrite, rbacAllowsWrite, type AccessPolicy, type RbacPermission } from "./permissions.js";
import { isSecretName, isVaultName, isVersion, parseVaultResourceId, vaultHost } from "./validate.js";
import { buildAuditQuery, tableToObjects, type LaTable } from "./audit.js";

type Fetch = typeof fetch;

const ARM = "https://management.azure.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const LOG_ANALYTICS = "https://api.loganalytics.io/v1";
const KV_API = "api-version=7.5";
const MAX_SECRET_CHARS = 25_000;

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function bearer(req: Request, header: string): string {
  const raw = req.get(header) ?? "";
  const token = header.toLowerCase() === "authorization" ? raw.replace(/^Bearer\s+/i, "") : raw;
  if (!token) throw new HttpError(401, `Missing ${header} token`, "MissingToken");
  return token;
}

function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "Malformed token", "MalformedToken");
  }
}

async function call<T>(fetchFn: Fetch, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchFn(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (body as any)?.error;
    const message = err?.message ?? err?.innererror?.message ?? (typeof body === "string" ? body : res.statusText);
    throw new HttpError(res.status, message || `Azure request failed (${res.status})`, err?.code ?? err?.innererror?.code);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** Follows Key Vault nextLink pages, only ever talking to the same vault host. */
async function kvPaged<T>(fetchFn: Fetch, host: string, firstUrl: string, token: string, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < maxPages; page++) {
    const body: { value?: T[]; nextLink?: string | null } = await call(fetchFn, url, token);
    items.push(...(body.value ?? []));
    url = body.nextLink ?? undefined;
    if (url && new URL(url).origin !== host) throw new HttpError(502, "Unexpected nextLink host");
  }
  return items;
}

const tail = (id: string) => id.split("/").filter(Boolean).pop() ?? "";

function mapAttributes(a: any = {}) {
  const t = (s?: number) => (s ? new Date(s * 1000).toISOString() : null);
  return { enabled: a.enabled ?? true, created: t(a.created), updated: t(a.updated), expires: t(a.exp), notBefore: t(a.nbf) };
}

interface VaultRow {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName?: string;
  location: string;
  rbac: boolean;
  accessPolicies?: AccessPolicy[];
}

export function createApp(opts: { fetch?: Fetch; clientId?: string; tenantId?: string } = {}) {
  const fetchFn = opts.fetch ?? fetch;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { message: "Too many requests, please try again later" } },
    })
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).then((data) => res.json(data)).catch(next);

  app.get("/api/config", (_req, res) => {
    res.json({ clientId: opts.clientId ?? "", tenantId: opts.tenantId ?? "organizations" });
  });

  app.get(
    "/api/vaults",
    route(async (req) => {
      const armToken = bearer(req, "authorization");
      const oid = String(jwtClaims(armToken).oid ?? "");

      const vaults: VaultRow[] = [];
      let skipToken: string | undefined;
      do {
        const body: any = await call(fetchFn, `${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`, armToken, {
          method: "POST",
          body: JSON.stringify({
            query: `resources
| where type =~ 'microsoft.keyvault/vaults'
| project id, name, resourceGroup, subscriptionId, location,
    rbac = tobool(properties.enableRbacAuthorization), accessPolicies = properties.accessPolicies
| join kind=leftouter (resourcecontainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, subscriptionName = name) on subscriptionId
| project-away subscriptionId1`,
            options: { resultFormat: "objectArray", $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
          }),
        });
        vaults.push(...(body.data ?? []));
        skipToken = body.$skipToken;
      } while (skipToken);

      let objectIds = [oid];
      const graphToken = req.get("x-graph-token");
      if (graphToken && vaults.some((v) => !v.rbac)) {
        try {
          const groups: any = await call(fetchFn, `${GRAPH}/me/getMemberObjects`, graphToken, {
            method: "POST",
            body: JSON.stringify({ securityEnabledOnly: false }),
          });
          objectIds = objectIds.concat(groups.value ?? []);
        } catch {
          // Group lookup is best-effort; direct user policies still work.
        }
      }

      const checked = await mapLimit(vaults, 10, async (v) => {
        if (!v.rbac) return accessPolicyAllowsWrite(v.accessPolicies, objectIds);
        try {
          const perms: { value?: RbacPermission[] } = await call(
            fetchFn,
            `${ARM}${v.id}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`,
            armToken
          );
          return rbacAllowsWrite(perms.value ?? []);
        } catch {
          return false;
        }
      });

      return vaults
        .filter((_, i) => checked[i])
        .map(({ accessPolicies: _ap, ...v }) => ({ ...v, authorization: v.rbac ? "rbac" : "accessPolicy" }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    })
  );

  const vaultParam = (req: Request) => {
    const name = req.params.vault;
    if (!isVaultName(name)) throw new HttpError(400, "Invalid vault name");
    return vaultHost(name);
  };
  const secretParam = (req: Request) => {
    const name = req.params.name;
    if (!isSecretName(name)) throw new HttpError(400, "Invalid secret name");
    return name;
  };

  app.get(
    "/api/vaults/:vault/secrets",
    route(async (req) => {
      const host = vaultParam(req);
      const items = await kvPaged<any>(fetchFn, host, `${host}/secrets?maxresults=25&${KV_API}`, bearer(req, "x-kv-token"));
      return items
        .filter((s) => !s.managed)
        .map((s) => ({ name: tail(s.id), contentType: s.contentType ?? null, tags: s.tags ?? {}, ...mapAttributes(s.attributes) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    })
  );

  app.get(
    "/api/vaults/:vault/secrets/:name/versions",
    route(async (req) => {
      const host = vaultParam(req);
      const name = secretParam(req);
      const items = await kvPaged<any>(
        fetchFn,
        host,
        `${host}/secrets/${name}/versions?maxresults=25&${KV_API}`,
        bearer(req, "x-kv-token")
      );
      return items
        .map((s) => ({ version: tail(s.id), contentType: s.contentType ?? null, tags: s.tags ?? {}, ...mapAttributes(s.attributes) }))
        .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    })
  );

  app.get(
    "/api/vaults/:vault/secrets/:name",
    route(async (req) => {
      const host = vaultParam(req);
      const name = secretParam(req);
      const version = req.query.version;
      if (version !== undefined && !isVersion(version)) throw new HttpError(400, "Invalid version");
      const s: any = await call(fetchFn, `${host}/secrets/${name}/${version ?? ""}?${KV_API}`, bearer(req, "x-kv-token"));
      return { name, version: tail(s.id), value: s.value ?? "", contentType: s.contentType ?? null, tags: s.tags ?? {}, ...mapAttributes(s.attributes) };
    })
  );

  app.put(
    "/api/vaults/:vault/secrets/:name",
    route(async (req) => {
      const host = vaultParam(req);
      const name = secretParam(req);
      const { value, contentType, tags } = req.body ?? {};
      if (typeof value !== "string") throw new HttpError(400, "value must be a string");
      if (value.length > MAX_SECRET_CHARS) throw new HttpError(400, `Secret exceeds ${MAX_SECRET_CHARS} characters`);
      if (contentType != null && (typeof contentType !== "string" || contentType.length > 255)) throw new HttpError(400, "Invalid contentType");
      if (tags != null && (typeof tags !== "object" || Array.isArray(tags) || Object.values(tags).some((t) => typeof t !== "string")))
        throw new HttpError(400, "Invalid tags");

      const s: any = await call(fetchFn, `${host}/secrets/${name}?${KV_API}`, bearer(req, "x-kv-token"), {
        method: "PUT",
        body: JSON.stringify({ value, ...(contentType ? { contentType } : {}), ...(tags ? { tags } : {}) }),
      });
      return { name, version: tail(s.id), contentType: s.contentType ?? null, tags: s.tags ?? {}, ...mapAttributes(s.attributes) };
    })
  );

  const vaultIdQuery = (req: Request) => {
    const id = req.query.resourceId;
    const parsed = parseVaultResourceId(id);
    if (!parsed) throw new HttpError(400, "Invalid vault resourceId");
    return { id: id as string, ...parsed };
  };
  const daysQuery = (req: Request) => {
    const days = Number(req.query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, "days must be 1-90");
    return days;
  };

  app.get(
    "/api/audit",
    route(async (req) => {
      const vault = vaultIdQuery(req);
      const days = daysQuery(req);
      const secretName = req.query.secretName;
      if (secretName !== undefined && !isSecretName(secretName)) throw new HttpError(400, "Invalid secret name");
      const body: { tables?: LaTable[] } = await call(fetchFn, `${LOG_ANALYTICS}${vault.id}/query`, bearer(req, "x-la-token"), {
        method: "POST",
        body: JSON.stringify({ query: buildAuditQuery(secretName as string | undefined, req.query.changes === "1"), timespan: `P${days}D` }),
      });
      return tableToObjects(body.tables?.[0]);
    })
  );

  app.get(
    "/api/activity",
    route(async (req) => {
      const vault = vaultIdQuery(req);
      const days = daysQuery(req);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const filter = encodeURIComponent(`eventTimestamp ge '${since}' and resourceUri eq '${vault.id}'`);
      const token = bearer(req, "authorization");
      const events: any[] = [];
      let url: string | undefined =
        `${ARM}/subscriptions/${vault.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$filter=${filter}`;
      for (let page = 0; url && page < 5; page++) {
        const body: any = await call(fetchFn, url, token);
        events.push(...(body.value ?? []));
        url = body.nextLink && new URL(body.nextLink).origin === ARM ? body.nextLink : undefined;
      }
      return events.map((e) => ({
        time: e.eventTimestamp,
        operation: e.operationName?.localizedValue ?? e.operationName?.value,
        status: e.status?.localizedValue ?? e.status?.value,
        caller: e.caller ?? null,
        level: e.level ?? null,
        correlationId: e.correlationId ?? null,
      }));
    })
  );

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { message: err.message, code: err.code } });
      return;
    }
    console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: { message: "Internal server error" } });
  });

  return app;
}
