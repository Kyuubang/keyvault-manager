import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function defineThemes() {
  monaco.editor.defineTheme("kv-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": css("--editor-bg-light", "#fbfcfb"),
      "editor.lineHighlightBackground": "#0f5c550a",
      "editorLineNumber.foreground": "#9aa5a2",
      "editor.selectionBackground": "#0f5c5530",
    },
  });
  monaco.editor.defineTheme("kv-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": css("--editor-bg-dark", "#141a19"),
      "editor.lineHighlightBackground": "#5fd4c40d",
      "editorLineNumber.foreground": "#5d6b68",
      "editor.selectionBackground": "#5fd4c438",
    },
  });
}

defineThemes();
loader.config({ monaco });

export { monaco };
