import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client.js";
import { createIdentity, listIdentities, revokeKey } from "../lib/management.js";
import { getSession } from "../lib/session.js";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => { if (!await getSession()) throw redirect({ to: "/sign-in" }); },
  component: Dashboard,
});

type Identity = { id: string; name: string; role: string; keys: Array<{ id: string; prefix: string; label: string; revokedAt: string | null }> };

function Dashboard() {
  const router = useRouter();
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [createdKey, setCreatedKey] = useState<string>();
  const [name, setName] = useState("");
  const [role, setRole] = useState<"reader" | "writer" | "reviewer" | "admin">("writer");
  const [keyLabel, setKeyLabel] = useState("");
  const reload = async () => setIdentities(await listIdentities() as unknown as Identity[]);
  useEffect(() => { void reload(); }, []);
  return <main className="shell"><header className="masthead"><div><p className="eyebrow">Team knowledge base</p><h1>Control room</h1></div><button onClick={async () => { await authClient.signOut(); router.navigate({ to: "/sign-in" }); }}>Sign out</button></header><div className="grid"><section className="card"><p className="eyebrow">New MCP identity</p><form className="grid" onSubmit={async (event) => { event.preventDefault(); const result = await createIdentity({ data: { name, role, keyLabel } }); setCreatedKey(result.key); setName(""); setKeyLabel(""); await reload(); }}><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude Code - billing" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="reader">Reader</option><option value="writer">Writer</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></label><label>Key label<input required value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="Ada's local Claude Code" /></label><button>Create identity and key</button></form>{createdKey && <><p className="eyebrow">Copy now. It will not be shown again.</p><p className="key">{createdKey}</p></>}</section><section className="card"><p className="eyebrow">Active identities</p><table><thead><tr><th>Identity</th><th>Role</th><th>Keys</th></tr></thead><tbody>{identities.map((identity) => <tr key={identity.id}><td>{identity.name}</td><td>{identity.role}</td><td>{identity.keys.map((key) => <div key={key.id}>{key.label} <span className="muted">{key.prefix}...</span> {key.revokedAt ? "revoked" : <button onClick={async () => { await revokeKey({ data: { keyId: key.id } }); await reload(); }}>Revoke</button>}</div>)}</td></tr>)}</tbody></table></section></div></main>;
}
