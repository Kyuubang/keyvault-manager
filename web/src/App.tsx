import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { KeyRound, LogOut } from "lucide-react";
import { api } from "./api";
import { signOut } from "./auth";
import { useAsync, useHashRoute } from "./util";
import { Sidebar } from "./components/Sidebar";

const SecretWorkspace = lazy(() => import("./components/SecretWorkspace").then((m) => ({ default: m.SecretWorkspace })));
const NewSecret = lazy(() => import("./components/NewSecret").then((m) => ({ default: m.NewSecret })));
import { EmptyState } from "./components/EmptyState";

export const NEW_SECRET = "+new";

export function App({ account }: { account: AccountInfo }) {
  const { vault: vaultName, secret, navigate } = useHashRoute();
  const vaults = useAsync(() => api.vaults(), []);
  const vault = useMemo(
    () => vaults.data?.find((v) => v.name.toLowerCase() === vaultName?.toLowerCase()),
    [vaults.data, vaultName]
  );
  const secrets = useAsync(() => (vault ? api.secrets(vault.name) : Promise.resolve([])), [vault?.name]);
  const [secretsVersion, setSecretsVersion] = useState(0);

  useEffect(() => {
    if (!vaultName && vaults.data?.length) {
      const last = localStorage.getItem("kvm:lastVault");
      const pick = vaults.data.find((v) => v.name === last) ?? vaults.data[0];
      navigate(pick.name);
    }
  }, [vaults.data, vaultName, navigate]);

  useEffect(() => {
    if (vault) localStorage.setItem("kvm:lastVault", vault.name);
  }, [vault]);

  const refreshSecrets = () => {
    secrets.reload();
    setSecretsVersion((n) => n + 1);
  };

  let main;
  if (vaults.error) main = <EmptyState tone="error" title="Couldn’t load your vaults" body={vaults.error} action={{ label: "Retry", onClick: vaults.reload }} />;
  else if (!vaults.loading && !vaults.data?.length)
    main = (
      <EmptyState
        title="No vaults you can edit"
        body="You only see Key Vaults where you can set secrets: the Key Vault Secrets Officer role (or higher) for RBAC vaults, or a Set secret access policy."
      />
    );
  else if (vaultName && vaults.data && !vault)
    main = <EmptyState title={`No write access to “${vaultName}”`} body="The vault doesn’t exist, or you can’t set secrets in it." />;
  else if (vault && secret === NEW_SECRET)
    main = (
      <NewSecret
        vault={vault}
        existing={secrets.data?.map((s) => s.name) ?? []}
        onCancel={() => navigate(vault.name)}
        onCreated={(name) => {
          refreshSecrets();
          navigate(vault.name, name);
        }}
      />
    );
  else if (vault && secret)
    main = <SecretWorkspace key={`${vault.name}/${secret}`} vault={vault} name={secret} onSaved={refreshSecrets} refreshKey={secretsVersion} />;
  else if (vault)
    main = <EmptyState title="Pick a secret" body="Choose a secret on the left to open its latest version, or create a new one." />;

  return (
    <div className={`shell ${secret ? "has-selection" : ""} ${vault ? "has-vault" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#/" onClick={() => navigate(vault?.name)}>
          <span className="brand-mark" aria-hidden>
            <KeyRound size={16} strokeWidth={2.25} />
          </span>
          Key Vault Manager
        </a>
        <div className="topbar-user">
          <span className="user-name" title={account.username}>
            {account.name ?? account.username}
          </span>
          <button className="btn btn-ghost btn-icon" onClick={() => signOut()} aria-label="Sign out" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <Sidebar
        vaults={vaults}
        vault={vault}
        secrets={secrets}
        selected={secret}
        onVault={(name) => navigate(name)}
        onSecret={(name) => vault && navigate(vault.name, name)}
        onNew={() => vault && navigate(vault.name, NEW_SECRET)}
      />
      <main className="main">
        <Suspense fallback={<div className="workspace"><div className="editor-skeleton" aria-busy="true" /></div>}>{main}</Suspense>
      </main>
    </div>
  );
}
