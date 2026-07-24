import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client.js";
import { getSession } from "../lib/session.js";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: async () => { if (await getSession()) throw redirect({ to: "/dashboard" }); },
  component: SignIn,
});

function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  return <main className="shell"><div className="card" style={{ maxWidth: 420, margin: "12vh auto" }}><p className="eyebrow">Team knowledge base</p><h1>Control room</h1><p className="muted">Sign in to manage MCP identities and credentials.</p><form onSubmit={async (event) => { event.preventDefault(); const result = await authClient.signIn.email({ email, password }); if (result.error) setError(result.error.message); else router.navigate({ to: "/dashboard" }); }} className="grid"><label>Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p>{error}</p>}<button>Sign in</button></form></div></main>;
}
