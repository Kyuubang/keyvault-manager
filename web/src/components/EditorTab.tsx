import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { DiffEditor, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { AlertTriangle, ArrowLeft, Columns2, GitCompare, Rows2, Save, Undo2, WrapText, Pilcrow } from "lucide-react";
import { monaco } from "../monaco";
import { api, type SecretValue, type SecretVersion, type Vault } from "../api";
import { detectLanguage, eolOf, errorMessage, formatDate, shortVersion, useDarkMode } from "../util";

export type EditorIntent = { type: "open" | "compare"; version: string; nonce?: number };
type Mode = "edit" | "compare" | "review";

const MAX_CHARS = 25_000;

export function EditorTab(props: {
  vault: Vault;
  name: string;
  versions: SecretVersion[];
  intent: EditorIntent | null;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const { vault, name, versions } = props;
  const dark = useDarkMode();
  const theme = dark ? "kv-dark" : "kv-light";

  const cache = useRef(new Map<string, SecretValue>());
  const [latest, setLatest] = useState<SecretValue | null>(null);
  const [base, setBase] = useState<SecretValue | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [compare, setCompare] = useState<SecretValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [contentType, setContentType] = useState("");
  const [wrap, setWrap] = useState(true);
  const [whitespace, setWhitespace] = useState(false);
  const [split, setSplit] = useState(true);

  const load = useCallback(
    async (version?: string, fresh = false): Promise<SecretValue> => {
      const hit = version && !fresh ? cache.current.get(version) : undefined;
      if (hit) return hit;
      const s = await api.secret(vault.name, name, version);
      cache.current.set(s.version, s);
      return s;
    },
    [vault.name, name]
  );

  useEffect(() => {
    let alive = true;
    load()
      .then((s) => {
        if (!alive) return;
        setLatest(s);
        setBase(s);
        setDraft(s.value);
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(
    () => () => {
      const prefix = `inmemory://kv/${vault.name}/${name}/`.toLowerCase();
      // Deferred so the DiffEditor widget detaches its models first.
      setTimeout(() => {
        for (const m of monaco.editor.getModels()) if (m.uri.toString().toLowerCase().startsWith(prefix)) m.dispose();
      }, 0);
    },
    [vault.name, name]
  );

  const latestValue = latest?.value ?? "";
  const dirty = !!base && draft !== base.value;
  const changedFromLatest = draft !== latestValue || (!latest && draft !== "");
  const viewingOld = !!base && !!latest && base.version !== latest.version;
  const tooLong = draft.length > MAX_CHARS;

  useEffect(() => props.onDirtyChange(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDiscard = () => !dirty || window.confirm("Discard your unsaved edits?");

  const openVersion = async (version: string) => {
    if (version === base?.version) return setMode("edit");
    if (!confirmDiscard()) return;
    setLoading(true);
    setError(null);
    try {
      const s = await load(version);
      setBase(s);
      setDraft(s.value);
      setMode("edit");
      setCompare(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const compareWith = async (version: string | null) => {
    if (!version) {
      setCompare(null);
      setMode("edit");
      return;
    }
    setError(null);
    try {
      setCompare(await load(version));
      setMode("compare");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const refreshLatest = async (): Promise<SecretValue | null> => {
    const current = await load(undefined, true).catch(() => null);
    if (current && latest && current.version !== latest.version) {
      setLatest(current);
      setNotice({
        tone: "warn",
        text: `Someone saved version ${shortVersion(current.version)} while you were editing. The diff now compares against it.`,
      });
    } else if (current && !latest) setLatest(current);
    return current;
  };

  const startReview = async () => {
    if (!changedFromLatest || tooLong) return;
    setNotice(null);
    setContentType(base?.contentType ?? latest?.contentType ?? "");
    setMode("review");
    await refreshLatest();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const current = await refreshLatest();
      if (current && latest && current.version !== latest.version) return;
      const saved = await api.save(vault.name, name, {
        value: draft,
        contentType: contentType.trim() || null,
        tags: (current ?? latest)?.tags,
      });
      const value: SecretValue = { ...saved, name, value: draft };
      cache.current.set(saved.version, value);
      setLatest(value);
      setBase(value);
      setMode("edit");
      setCompare(null);
      setNotice({ tone: "ok", text: `Saved as version ${shortVersion(saved.version)}.` });
      props.onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const i = props.intent;
    if (!i) return;
    if (i.type === "open") openVersion(i.version);
    else compareWith(i.version);
  }, [props.intent?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const reviewRef = useRef(startReview);
  reviewRef.current = mode === "review" ? save : startReview;
  const bindSave = (ed: editor.IStandaloneCodeEditor, monaco: Monaco) =>
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => reviewRef.current());

  const language = useMemo(() => detectLanguage(base?.value ?? draft, base?.contentType), [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const editorOptions: editor.IStandaloneEditorConstructionOptions = {
    fontFamily: "ui-monospace, \"SF Mono\", \"Cascadia Code\", Menlo, Consolas, monospace",
    fontSize: 13,
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: wrap ? "on" : "off",
    renderWhitespace: whitespace ? "all" : "selection",
    renderFinalNewline: "on",
    automaticLayout: true,
    padding: { top: 12, bottom: 12 },
    unicodeHighlight: { ambiguousCharacters: true, invisibleCharacters: true },
    stickyScroll: { enabled: false },
  };
  const diffOptions: editor.IDiffEditorConstructionOptions = {
    ...editorOptions,
    renderSideBySide: split,
    useInlineViewWhenSpaceIsLimited: true,
    ignoreTrimWhitespace: false,
    renderOverviewRuler: false,
    originalEditable: false,
  };

  // Reused, never-disposed models avoid Monaco's "TextModel got disposed before DiffEditorWidget model got reset".
  const diffModelProps = (kind: string) => ({
    originalModelPath: `inmemory://kv/${vault.name}/${name}/${kind}-original`,
    modifiedModelPath: `inmemory://kv/${vault.name}/${name}/${kind}-modified`,
    keepCurrentOriginalModel: true,
    keepCurrentModifiedModel: true,
  });

  const syncDiff = (ed: editor.IStandaloneDiffEditor, original: string, modified: string) => {
    const models = ed.getModel();
    if (models && models.original.getValue() !== original) models.original.setValue(original);
    if (models && models.modified.getValue() !== modified) models.modified.setValue(modified);
  };

  const versionLabel = (v: SecretVersion) =>
    `${v.version === latest?.version ? "Latest · " : ""}${shortVersion(v.version)} · ${formatDate(v.created)}${v.enabled ? "" : " (disabled)"}`;

  const toggles = (
    <div className="toggle-group" role="group" aria-label="View options">
      <button className="btn btn-ghost btn-icon" aria-pressed={wrap} onClick={() => setWrap(!wrap)} title="Wrap long lines" aria-label="Wrap long lines">
        <WrapText size={15} />
      </button>
      <button
        className="btn btn-ghost btn-icon"
        aria-pressed={whitespace}
        onClick={() => setWhitespace(!whitespace)}
        title="Show whitespace"
        aria-label="Show whitespace"
      >
        <Pilcrow size={15} />
      </button>
      {mode !== "edit" && (
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setSplit(!split)}
          title={split ? "Inline diff" : "Side-by-side diff"}
          aria-label={split ? "Switch to inline diff" : "Switch to side-by-side diff"}
        >
          {split ? <Rows2 size={15} /> : <Columns2 size={15} />}
        </button>
      )}
    </div>
  );

  if (loading && !base && !error) return <div className="editor-skeleton" aria-busy="true" aria-label="Loading secret" />;

  return (
    <div className="editor-tab">
      {mode === "review" ? (
        <div className="toolbar toolbar-review">
          <button className="btn btn-ghost" onClick={() => setMode("edit")}>
            <ArrowLeft size={15} /> Back to editing
          </button>
          <span className="toolbar-title">
            Review changes against <strong>{latest ? `latest (${shortVersion(latest.version)})` : "an empty value"}</strong>
          </span>
          <span className="grow" />
          {toggles}
        </div>
      ) : (
        <div className="toolbar">
          <label className="inline-field">
            <span>Version</span>
            <select className="select" value={base?.version ?? ""} onChange={(e) => openVersion(e.target.value)}>
              {!base && <option value="">—</option>}
              {versions.map((v) => (
                <option key={v.version} value={v.version} disabled={!v.enabled}>
                  {versionLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>
              <GitCompare size={14} aria-hidden /> Compare with
            </span>
            <select className="select" value={mode === "compare" ? compare?.version ?? "" : ""} onChange={(e) => compareWith(e.target.value || null)}>
              <option value="">Nothing</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version} disabled={!v.enabled}>
                  {versionLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <span className="grow" />
          {toggles}
          {dirty && (
            <button className="btn btn-ghost" onClick={() => base && setDraft(base.value)} title="Undo all edits">
              <Undo2 size={15} /> Discard
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!changedFromLatest || tooLong}
            onClick={startReview}
            title={changedFromLatest ? "Review the diff before saving (Ctrl/⌘+S)" : "Nothing differs from the latest version"}
          >
            {viewingOld && !dirty ? "Review restore" : "Review changes"}
          </button>
        </div>
      )}

      {viewingOld && mode === "edit" && (
        <div className="callout">
          You’re viewing version <span className="mono">{shortVersion(base?.version)}</span> from {formatDate(base?.created)}. Saving
          creates a new latest version with this content; older versions stay untouched.
        </div>
      )}
      {mode === "compare" && compare && (
        <div className="callout callout-quiet">
          Left: version <span className="mono">{shortVersion(compare.version)}</span> ({formatDate(compare.created)}). Right: your editor,
          still editable.
        </div>
      )}
      {notice && (
        <div className={`callout ${notice.tone === "warn" ? "callout-warn" : "callout-ok"}`} role="status">
          {notice.tone === "warn" && <AlertTriangle size={15} aria-hidden />} {notice.text}
        </div>
      )}
      {error && (
        <div className="callout callout-error" role="alert">
          {error}
        </div>
      )}

      <div className="editor-frame">
        {mode === "edit" && (
          <Editor
            height="100%"
            theme={theme}
            language={language}
            value={draft}
            onChange={(v) => setDraft(v ?? "")}
            options={editorOptions}
            onMount={bindSave}
          />
        )}
        {mode === "compare" && compare && (
          <DiffEditor
            height="100%"
            theme={theme}
            language={language}
            original={compare.value}
            modified={draft}
            options={diffOptions}
            {...diffModelProps("compare")}
            onMount={(ed, monaco) => {
              syncDiff(ed, compare.value, draft);
              const modified = ed.getModifiedEditor();
              modified.onDidChangeModelContent(() => setDraft(modified.getValue()));
              bindSave(modified, monaco);
            }}
          />
        )}
        {mode === "review" && (
          <DiffEditor
            height="100%"
            theme={theme}
            language={language}
            original={latestValue}
            modified={draft}
            options={{ ...diffOptions, readOnly: true }}
            {...diffModelProps("review")}
            onMount={(ed, monaco) => {
              syncDiff(ed, latestValue, draft);
              bindSave(ed.getModifiedEditor(), monaco);
            }}
          />
        )}
      </div>

      {mode === "review" ? (
        <div className="savebar">
          <label className="inline-field">
            <span>Content type</span>
            <input
              className="input"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              placeholder="optional, e.g. application/json"
              maxLength={255}
            />
          </label>
          <span className="grow" />
          <span className="savebar-note">Tags carry over from the latest version.</span>
          <button className="btn btn-primary" onClick={save} disabled={saving || !changedFromLatest}>
            <Save size={15} /> {saving ? "Saving…" : "Save as new version"}
          </button>
        </div>
      ) : (
        <div className="statusbar" aria-live="polite">
          <span className={tooLong ? "error-text" : ""}>
            {draft.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
          </span>
          <span>{draft.split("\n").length} lines</span>
          <span>{eolOf(draft)}</span>
          <span>{draft.endsWith("\n") ? "Ends with newline" : "No trailing newline"}</span>
          <span className="grow" />
          {dirty ? <span className="dirty-label">Unsaved edits</span> : <span>No edits</span>}
        </div>
      )}
    </div>
  );
}
