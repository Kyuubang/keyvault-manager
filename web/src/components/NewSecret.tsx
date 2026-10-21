import { useState } from "react";
import Editor from "@monaco-editor/react";
import { ArrowLeft } from "lucide-react";
import "../monaco";
import { api, type Vault } from "../api";
import { detectLanguage, errorMessage, useDarkMode } from "../util";

const NAME = /^[0-9a-zA-Z-]{1,127}$/;

export function NewSecret(props: { vault: Vault; existing: string[]; onCancel: () => void; onCreated: (name: string) => void }) {
  const dark = useDarkMode();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [contentType, setContentType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = props.existing.some((n) => n.toLowerCase() === name.toLowerCase());
  const nameError = !name ? null : !NAME.test(name) ? "Use letters, numbers and dashes only (max 127)." : taken ? "A secret with this name already exists." : null;
  const canSave = !!name && !nameError && value.length > 0 && value.length <= 25_000 && !saving;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.save(props.vault.name, name, { value, contentType: contentType.trim() || null });
      props.onCreated(name);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <section className="workspace">
      <header className="ws-header">
        <button className="btn btn-ghost btn-icon back-link" onClick={props.onCancel} aria-label="Back to secrets">
          <ArrowLeft size={16} />
        </button>
        <div className="ws-title">
          <h1>New secret</h1>
          <p className="ws-meta">in {props.vault.name}</p>
        </div>
      </header>
      <div className="form-row">
        <label className="stack-field grow">
          <span>Name</span>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. api-gateway-config"
            aria-invalid={!!nameError}
            aria-describedby="name-help"
          />
          <small id="name-help" className={nameError ? "error-text" : "muted"}>
            {nameError ?? "Letters, numbers and dashes."}
          </small>
        </label>
        <label className="stack-field">
          <span>Content type</span>
          <input className="input" value={contentType} onChange={(e) => setContentType(e.target.value)} placeholder="optional" maxLength={255} />
          <small className="muted">For example text/plain or application/json.</small>
        </label>
      </div>
      {error && (
        <div className="callout callout-error" role="alert">
          {error}
        </div>
      )}
      <div className="editor-frame">
        <Editor
          height="100%"
          theme={dark ? "kv-dark" : "kv-light"}
          language={detectLanguage(value, contentType)}
          value={value}
          onChange={(v) => setValue(v ?? "")}
          options={{
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
      <div className="savebar">
        <span className="savebar-note">{value.length.toLocaleString()} / 25,000 chars</span>
        <span className="grow" />
        <button className="btn btn-ghost" onClick={props.onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!canSave} onClick={create}>
          {saving ? "Creating…" : "Create secret"}
        </button>
      </div>
    </section>
  );
}
