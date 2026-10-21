import { getToken } from "./auth";

export interface Vault {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName?: string;
  location: string;
  authorization: "rbac" | "accessPolicy";
}
interface Attributes {
  enabled: boolean;
  created: string | null;
  updated: string | null;
  expires: string | null;
  notBefore: string | null;
}
export interface SecretItem extends Attributes {
  name: string;
  contentType: string | null;
  tags: Record<string, string>;
}
export interface SecretVersion extends Attributes {
  version: string;
  contentType: string | null;
  tags: Record<string, string>;
}
export interface SecretValue extends SecretVersion {
  name: string;
  value: string;
}
export type AuditRow = {
  TimeGenerated: string;
  OperationName: string;
  Result: string;
  StatusCode: string;
  CallerIp: string;
  Caller: string;
  Target: string;
  Client: string;
};
export interface ActivityEvent {
  time: string;
  operation: string;
  status: string;
  caller: string | null;
  level: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(path: string, headers: Record<string, string>, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? res.statusText, body?.error?.code);
  return body as T;
}

const kv = async () => ({ "x-kv-token": await getToken("kv") });
const enc = encodeURIComponent;

export const api = {
  async vaults(): Promise<Vault[]> {
    const [arm, graph] = await Promise.all([getToken("arm"), getToken("graph").catch(() => "")]);
    return request("/api/vaults", { Authorization: `Bearer ${arm}`, ...(graph ? { "x-graph-token": graph } : {}) });
  },
  async secrets(vault: string): Promise<SecretItem[]> {
    return request(`/api/vaults/${enc(vault)}/secrets`, await kv());
  },
  async versions(vault: string, name: string): Promise<SecretVersion[]> {
    return request(`/api/vaults/${enc(vault)}/secrets/${enc(name)}/versions`, await kv());
  },
  async secret(vault: string, name: string, version?: string): Promise<SecretValue> {
    const q = version ? `?version=${enc(version)}` : "";
    return request(`/api/vaults/${enc(vault)}/secrets/${enc(name)}${q}`, await kv());
  },
  async save(vault: string, name: string, body: { value: string; contentType?: string | null; tags?: Record<string, string> }) {
    return request<SecretVersion & { name: string }>(`/api/vaults/${enc(vault)}/secrets/${enc(name)}`, await kv(), {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  async audit(resourceId: string, days: number, secret?: string): Promise<AuditRow[]> {
    const q = `resourceId=${enc(resourceId)}&days=${days}${secret ? `&secret=${enc(secret)}` : ""}`;
    return request(`/api/audit?${q}`, { "x-la-token": await getToken("la") });
  },
  async activity(resourceId: string, days: number): Promise<ActivityEvent[]> {
    return request(`/api/activity?resourceId=${enc(resourceId)}&days=${days}`, { Authorization: `Bearer ${await getToken("arm")}` });
  },
};
