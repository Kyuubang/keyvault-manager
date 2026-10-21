import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export const shortVersion = (v?: string | null) => (v ? v.slice(0, 7) : "");

const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (iso?: string | null) => (iso ? dtf.format(new Date(iso)) : "—");

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return "just now";
}

export function detectLanguage(value: string, contentType?: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("yaml") || ct.includes("yml")) return "yaml";
  if (ct.includes("xml")) return "xml";
  const t = value.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (t.startsWith("<") && t.endsWith(">") && !t.startsWith("-----")) return "xml";
  if (/^[A-Za-z_][A-Za-z0-9_.]*=/m.test(t) && !t.includes("-----BEGIN")) return "ini";
  return "plaintext";
}

export const eolOf = (value: string) => (value.includes("\r\n") ? "CRLF" : "LF");

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Runs an async loader when deps change; ignores stale results. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => id === seq.current && setState({ data, loading: false }),
      (e) => id === seq.current && setState({ error: errorMessage(e), loading: false })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
export function useDarkMode() {
  return useSyncExternalStore(
    (cb) => {
      darkQuery?.addEventListener("change", cb);
      return () => darkQuery?.removeEventListener("change", cb);
    },
    () => darkQuery?.matches ?? false
  );
}

export function parseHash(): { vault?: string; secret?: string } {
  const [vault, secret] = window.location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  return { vault: vault || undefined, secret: secret || undefined };
}
export function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const navigate = useCallback((vault?: string, secret?: string) => {
    const parts = [vault, secret].filter(Boolean).map((p) => encodeURIComponent(p!));
    window.location.hash = parts.length ? `/${parts.join("/")}` : "";
  }, []);
  return { ...route, navigate };
}
