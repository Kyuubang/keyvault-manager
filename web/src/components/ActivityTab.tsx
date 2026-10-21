import { useState } from "react";
import { api, type Vault } from "../api";
import { formatDate, relativeTime, useAsync } from "../util";

const RANGES = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const friendlyOp = (op: string) => op.replace(/^Secret/, "Secret ").replace(/([a-z])([A-Z])/g, "$1 $2");

export function ActivityTab({ vault, secret }: { vault: Vault; secret: string }) {
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState<"secret" | "vault">("secret");
  const audit = useAsync(() => api.audit(vault.id, days, scope === "secret" ? secret : undefined), [vault.id, days, scope, secret]);
  const activity = useAsync(() => api.activity(vault.id, days), [vault.id, days]);

  return (
    <div className="activity">
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Scope">
          {(["secret", "vault"] as const).map((s) => (
            <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}>
              {s === "secret" ? `This secret` : "Whole vault"}
            </button>
          ))}
        </div>
        <label className="inline-field">
          <span>Last</span>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="activity-section">
        <h2>Secret access</h2>
        <p className="section-note">Reads, writes and denied attempts, from the vault’s diagnostic logs in Log Analytics.</p>
        {audit.error ? (
          <p className="callout callout-error" role="alert">
            {audit.error}
            <br />
            You need Log Analytics Reader (or Reader on the vault) to read its audit logs.
          </p>
        ) : audit.loading ? (
          <div className="table-skeleton" aria-busy="true" />
        ) : !audit.data?.length ? (
          <p className="callout callout-quiet">
            No audit events in the last {RANGES.find((r) => r.days === days)?.label}. If you expected some, check that the vault has a
            diagnostic setting sending <strong>AuditEvent</strong> logs to a Log Analytics workspace.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Operation</th>
                  <th>Who</th>
                  <th>From IP</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((r, i) => {
                  const failed = Number(r.StatusCode) >= 400 || /forbidden|unauthorized|fail/i.test(r.Result);
                  return (
                    <tr key={i}>
                      <td>
                        <time dateTime={r.TimeGenerated} title={formatDate(r.TimeGenerated)}>
                          {relativeTime(r.TimeGenerated)}
                        </time>
                      </td>
                      <td>{friendlyOp(r.OperationName)}</td>
                      <td className="cell-wrap">{r.Caller || <span className="muted">Unknown</span>}</td>
                      <td className="mono">{r.CallerIp || "—"}</td>
                      <td>
                        <span className={`badge ${failed ? "badge-danger" : "badge-ok"}`}>
                          {r.Result || r.StatusCode || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="activity-section">
        <h2>Vault changes</h2>
        <p className="section-note">Configuration changes to the vault itself (access, network, settings) from the Azure Activity Log.</p>
        {activity.error ? (
          <p className="callout callout-error" role="alert">{activity.error}</p>
        ) : activity.loading ? (
          <div className="table-skeleton" aria-busy="true" />
        ) : !activity.data?.length ? (
          <p className="callout callout-quiet">No changes to the vault in this period.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Operation</th>
                  <th>Who</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activity.data.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <time dateTime={e.time} title={formatDate(e.time)}>
                        {relativeTime(e.time)}
                      </time>
                    </td>
                    <td>{e.operation}</td>
                    <td className="cell-wrap">{e.caller ?? <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${/fail/i.test(e.status) ? "badge-danger" : "badge-ok"}`}>{e.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
