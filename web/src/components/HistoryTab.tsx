import { FileText, GitCompare } from "lucide-react";
import type { SecretVersion } from "../api";
import { formatDate, relativeTime, shortVersion } from "../util";

export function HistoryTab(props: {
  versions: { data?: SecretVersion[]; loading: boolean; error?: string };
  onOpen: (version: string) => void;
  onCompare: (version: string) => void;
}) {
  const { data, loading, error } = props.versions;
  if (error) return <p className="callout callout-error" role="alert">{error}</p>;
  if (loading && !data) return <div className="table-skeleton" aria-busy="true" />;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Created</th>
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
        Open loads a version into the editor. Compare shows it next to whatever is in your editor right now.
      </p>
    </div>
  );
}
