import { FileText, GitCompare } from "lucide-react";
import { api, type SecretVersion, type Vault } from "../api";
import { formatDate, relativeTime, shortVersion, useAsync } from "../util";

const SET_VERSION = /\/secrets\/[^/]+\/([0-9a-fA-F]{32})/;
const WRITES = /^Secret(Set|Update)$/i;

export function HistoryTab(props: {
  vault: Vault;
  secret: string;
  versions: { data?: SecretVersion[]; loading: boolean; error?: string };
  onOpen: (version: string) => void;
  onCompare: (version: string) => void;
}) {
  const { data, loading, error } = props.versions;
  // Older versions have no updatedBy tag, so fall back to the audit log (best effort).
  const audit = useAsync(() => api.audit(props.vault.id, 90, props.secret, true).catch(() => []), [props.vault.id, props.secret, data?.length]);
  const auditCaller = new Map<string, string>();
  for (const r of audit.data ?? []) {
    const version = SET_VERSION.exec(r.Target)?.[1];
    if (version && r.Caller && WRITES.test(r.OperationName) && !auditCaller.has(version)) auditCaller.set(version, r.Caller);
  }
  if (error) return <p className="callout callout-error" role="alert">{error}</p>;
  if (loading && !data) return <div className="table-skeleton" aria-busy="true" />;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Created</th>
            <th>Updated by</th>
            <th>Status</th>
            <th>Content type</th>
            <th>Expires</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {data?.map((v, i) => (
            <tr key={v.version}>
              <td>
                <span className="mono">{shortVersion(v.version)}</span>
                {i === 0 && <span className="badge badge-accent">Latest</span>}
              </td>
              <td>
                <time dateTime={v.created ?? undefined} title={formatDate(v.created)}>
                  {formatDate(v.created)}
                </time>
                <span className="cell-sub">{relativeTime(v.created)}</span>
              </td>
              <td className="cell-wrap">
                {v.tags.updatedBy ?? auditCaller.get(v.version) ?? (audit.loading ? <span className="skeleton-inline" /> : <span className="muted">Unknown</span>)}
              </td>
              <td>{v.enabled ? "Enabled" : <span className="badge badge-muted">Disabled</span>}</td>
              <td>{v.contentType ?? <span className="muted">—</span>}</td>
              <td>{v.expires ? formatDate(v.expires) : <span className="muted">Never</span>}</td>
              <td className="cell-actions">
                <button className="btn btn-ghost btn-sm" disabled={!v.enabled} onClick={() => props.onOpen(v.version)}>
                  <FileText size={14} /> Open
                </button>
                <button className="btn btn-ghost btn-sm" disabled={!v.enabled} onClick={() => props.onCompare(v.version)}>
                  <GitCompare size={14} /> Compare
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        Updated by comes from the version’s <span className="mono">updatedBy</span> tag, which this app adds on every save. Versions saved
        elsewhere fall back to the audit log (last 90 days). Open loads a version into the editor. Compare shows it next to whatever is in your editor right now.
      </p>
    </div>
  );
}
