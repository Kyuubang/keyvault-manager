import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import type { SecretItem, Vault } from "../api";
import { relativeTime } from "../util";

interface AsyncList<T> {
  data?: T[];
  error?: string;
  loading: boolean;
  reload: () => void;
}

export function Sidebar(props: {
  vaults: AsyncList<Vault>;
  vault?: Vault;
  secrets: AsyncList<SecretItem>;
  selected?: string;
  onVault: (name: string) => void;
  onSecret: (name: string) => void;
  onNew: () => void;
}) {
  const { vaults, vault, secrets, selected } = props;
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, Vault[]>();
    for (const v of vaults.data ?? []) {
      const key = v.subscriptionName ?? v.subscriptionId;
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [vaults.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (secrets.data ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [secrets.data, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <label className="field-label" htmlFor="vault-select">
          Vault
        </label>
        <div className="row">
          <select
            id="vault-select"
            className="select grow"
            value={vault?.name ?? ""}
            disabled={vaults.loading && !vaults.data}
            onChange={(e) => props.onVault(e.target.value)}
          >
            {vaults.loading && !vaults.data && <option>Finding vaults you can edit…</option>}
            {!vault && vaults.data && <option value="">Select a vault</option>}
            {groups.map(([sub, list]) => (
              <optgroup key={sub} label={sub}>
                {list.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => {
              vaults.reload();
              secrets.reload();
            }}
            aria-label="Refresh vaults and secrets"
            title="Refresh"
          >
            <RefreshCw size={15} className={vaults.loading || secrets.loading ? "spin" : ""} />
          </button>
        </div>
        {vault && (
          <p className="vault-meta">
            {vault.resourceGroup} · {vault.location} · {vault.authorization === "rbac" ? "RBAC" : "Access policies"}
          </p>
        )}
      </div>

      {vault && (
        <>
          <div className="sidebar-section sidebar-tools">
            <div className="search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                placeholder={`Filter ${secrets.data?.length ?? ""} secrets`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter secrets"
              />
            </div>
            <button className="btn btn-icon" onClick={props.onNew} aria-label="New secret" title="New secret">
              <Plus size={16} />
            </button>
          </div>

          <nav className="secret-list" aria-label="Secrets">
            {secrets.loading && !secrets.data?.length &&
              Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-row" />)}
            {secrets.error && <p className="list-note error-text">{secrets.error}</p>}
            {!secrets.loading && !secrets.error && secrets.data?.length === 0 && (
              <p className="list-note">This vault has no secrets yet. Use + to create the first one.</p>
            )}
            {!!secrets.data?.length && !filtered.length && <p className="list-note">No secrets match “{query}”.</p>}
            {filtered.map((s) => (
              <button
                key={s.name}
                className={`secret-item ${s.name === selected ? "active" : ""}`}
                aria-current={s.name === selected ? "page" : undefined}
                onClick={() => props.onSecret(s.name)}
              >
                <span className="secret-name">{s.name}</span>
                <span className="secret-sub">
                  {!s.enabled && <span className="badge badge-muted">Disabled</span>}
                  {s.expires && new Date(s.expires) < new Date() && <span className="badge badge-warn">Expired</span>}
                  <span>Updated {relativeTime(s.updated)}</span>
                </span>
              </button>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
