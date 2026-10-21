import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, type Vault } from "../api";
import { formatDate, relativeTime, shortVersion, useAsync } from "../util";
import { EditorTab, type EditorIntent } from "./EditorTab";
import { HistoryTab } from "./HistoryTab";
import { ActivityTab } from "./ActivityTab";

type Tab = "editor" | "history" | "activity";

export function SecretWorkspace(props: { vault: Vault; name: string; onSaved: () => void; refreshKey: number }) {
  const { vault, name } = props;
  const versions = useAsync(() => api.versions(vault.name, name), [vault.name, name, props.refreshKey]);
  const [tab, setTab] = useState<Tab>("editor");
  const [intent, setIntent] = useState<EditorIntent | null>(null);
  const [dirty, setDirty] = useState(false);
  const latest = versions.data?.[0];

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const openInEditor = (next: EditorIntent) => {
    setIntent({ ...next, nonce: Date.now() });
    setTab("editor");
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "editor", label: "Editor" },
    { id: "history", label: "History", count: versions.data?.length },
    { id: "activity", label: "Activity" },
  ];

  return (
    <section className="workspace">
      <header className="ws-header">
        <a className="btn btn-ghost btn-icon back-link" href={`#/${encodeURIComponent(vault.name)}`} aria-label="Back to secrets">
          <ArrowLeft size={16} />
        </a>
        <div className="ws-title">
          <h1>
            {name}
            {dirty && <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
          </h1>
          <p className="ws-meta">
            {latest ? (
              <>
                <span className="mono">{shortVersion(latest.version)}</span> is latest · updated{" "}
                <time dateTime={latest.updated ?? undefined} title={formatDate(latest.updated)}>
                  {relativeTime(latest.updated)}
                </time>
                {latest.contentType && <> · {latest.contentType}</>}
                {!latest.enabled && <span className="badge badge-muted">Disabled</span>}
                {latest.expires && <> · expires {formatDate(latest.expires)}</>}
              </>
            ) : versions.error ? (
              <span className="error-text">{versions.error}</span>
            ) : (
              <span className="skeleton-inline" />
            )}
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="tab-panel" role="tabpanel" id="panel-editor" aria-labelledby="tab-editor" hidden={tab !== "editor"}>
        <EditorTab
          vault={vault}
          name={name}
          versions={versions.data ?? []}
          intent={intent}
          onDirtyChange={setDirty}
          onSaved={() => {
            versions.reload();
            props.onSaved();
          }}
        />
      </div>
      {tab === "history" && (
        <div className="tab-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <HistoryTab
            versions={versions}
            onOpen={(version) => openInEditor({ type: "open", version })}
            onCompare={(version) => openInEditor({ type: "compare", version })}
          />
        </div>
      )}
      {tab === "activity" && (
        <div className="tab-panel" role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">
          <ActivityTab vault={vault} secret={name} />
        </div>
      )}
    </section>
  );
}
