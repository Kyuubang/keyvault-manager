import { KeyRound } from "lucide-react";
import { signIn } from "../auth";

export function SignIn() {
  return (
    <main className="signin">
      <div className="signin-panel">
        <span className="brand-mark" aria-hidden>
          <KeyRound size={22} strokeWidth={2} />
        </span>
        <h1>Key Vault Manager</h1>
        <p>
          Edit Key Vault secrets, review every version, and see who touched them. You only see vaults you can write to,
          and every action runs as you.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => signIn()}>
          Sign in with Microsoft
        </button>
      </div>
    </main>
  );
}

export function StartupError({ message }: { message: string }) {
  return (
    <main className="signin">
      <div className="signin-panel">
        <h1>Can’t start</h1>
        <p className="error-text">{message}</p>
        <button className="btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </main>
  );
}
