import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initAuth } from "./auth";
import { App } from "./App";
import { SignIn, StartupError } from "./components/SignIn";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

initAuth().then(
  (account) =>
    root.render(<StrictMode>{account ? <App account={account} /> : <SignIn />}</StrictMode>),
  (e) => root.render(<StartupError message={e instanceof Error ? e.message : String(e)} />)
);
