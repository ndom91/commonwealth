import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { authClient } from "../lib/auth-client.js";
import {
  createIdentity,
  issueCredential,
  listIdentities,
  revokeKey,
  setIdentityDisabled,
  updateIdentity,
} from "../lib/management.js";
import { getNavCounts } from "../lib/knowledge.js";
import { getSession } from "../lib/session.js";
import { readFailure } from "../lib/read-failure.js";
import { AppShell, SealChip, accessionOf, stamp, stampAt } from "../components/chrome.js";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { holder: session.user.email ?? session.user.name ?? undefined };
  },
  /* Counts are decorative and degrade to a dash; the register below reports a
     read failure in full, and two alarms for one fault would be noise. */
  loader: async () => ({ counts: await getNavCounts().catch(() => undefined) }),
  component: Dashboard,
});

type Role = "reader" | "writer" | "reviewer" | "admin";

type Credential = {
  id: string;
  prefix: string;
  /* Null for credentials that were not issued through this UI — the bootstrap
     admin key has no managed_api_key row to carry a label. */
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Identity = {
  id: string;
  name: string;
  role: Role;
  /* An administrator's note on what this holder is for. Never read by the MCP
     layer and never returned to an agent. */
  description: string | null;
  created_at: string;
  /* Set while the holder is suspended. AccessService refuses every credential
     they own for as long as it is non-null. */
  disabled_at: string | null;
  /* When true this holder's submissions and revisions arrive approved instead
     of queuing for review. */
  auto_approve: boolean;
  keys: Credential[];
};

type Issued = { identityId: string; key: string; prefix: string };
type Status = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

const ROLES: Role[] = ["reader", "writer", "reviewer", "admin"];

const labelOf = (key: Credential) => key.label?.trim() || `Unlabelled · ${key.prefix}`;

/* Only immutable moments belong on the line: the holder's registration, and
   each credential's issue and void. `lastUsedAt` is a mutable column, not an
   event — putting it here would make the line rewrite itself every time an
   agent presented the key, so it stays on the credential stub instead. */
function custodyLine(identity: Identity) {
  const entries: Array<{ at: string; what: string }> = [
    { at: identity.created_at, what: "Holder registered" },
  ];
  for (const key of identity.keys) {
    const label = labelOf(key);
    entries.push({ at: key.createdAt, what: `Credential issued — ${label}` });
    if (key.revokedAt) entries.push({ at: key.revokedAt, what: `Credential voided — ${label}` });
  }
  return entries
    .filter((entry) => entry.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function Dashboard() {
  const router = useRouter();
  const { holder } = Route.useRouteContext();
  const { counts } = Route.useLoaderData();

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [selectedId, setSelectedId] = useState<string>();
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<Issued>();
  const [error, setError] = useState<string>();

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("writer");
  const [keyLabel, setKeyLabel] = useState("");
  const [pending, setPending] = useState(false);

  /* `rail` is false on first load only: the route loader has just supplied the
     counts, so invalidating would fetch them a second time. Every mutation
     path leaves it true, because creating or disabling a holder moves the
     rail's Identities count as well as this register. */
  const reload = async (rail = true) => {
    try {
      setIdentities((await listIdentities()) as unknown as Identity[]);
      setStatus({ state: "ready" });
      if (rail) void router.invalidate();
    } catch (cause) {
      setStatus({ state: "error", message: readFailure(cause, "The register") });
    }
  };

  useEffect(() => {
    void reload(false);
  }, []);

  const selected = useMemo(
    () => identities.find((identity) => identity.id === selectedId),
    [identities, selectedId],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await createIdentity({ data: { name, role, keyLabel } });
      setIssued(result);
      setSelectedId(result.identityId);
      setIssuing(false);
      setName("");
      setKeyLabel("");
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was issued — adjust the details and try again.`
          : "The identity could not be created. Nothing was issued — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell
      title="Identities"
      accession="Access register"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: "/sign-in" });
      }}
      actions={
        <button
          type="button"
          className="btn btn--primary"
          disabled={status.state !== "ready"}
          onClick={() => {
            setIssuing(true);
            setSelectedId(undefined);
          }}
        >
          Issue identity
        </button>
      }
    >
      <div className="panes">
        <section className="index" aria-label="Identity register">
          <div className="index__head">
            <span className="label">Holders</span>
            <span className="label register">
              {status.state === "ready" ? identities.length : "—"}
            </span>
          </div>

          {status.state === "ready" && identities.length > 0 && (
            <div className="index__cols">
              <span className="label">Holder</span>
              <span className="label">Role</span>
            </div>
          )}

          {status.state === "loading" && <p className="empty index__note">Reading register…</p>}

          {status.state === "error" && (
            <div className="index__note">
              <p className="notice" role="alert">
                {status.message}
              </p>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setStatus({ state: "loading" });
                  void reload();
                }}
              >
                Retry
              </button>
            </div>
          )}

          {status.state === "ready" && identities.length === 0 && (
            <p className="empty index__note">
              No identities yet. Issue one to give an agent a credential it can
              present at <code className="register">/mcp</code>.
            </p>
          )}

          <ul className="index__list">
            {identities.map((identity) => {
              const live = identity.keys.filter((key) => !key.revokedAt).length;
              return (
                <li key={identity.id}>
                  <button
                    type="button"
                    className={`entry${identity.disabled_at ? " entry--disabled" : ""}`}
                    aria-current={identity.id === selectedId}
                    onClick={() => {
                      setSelectedId(identity.id);
                      setIssuing(false);
                    }}
                  >
                    <span className="entry__name">{identity.name}</span>
                    <span className="entry__accession">
                      {accessionOf(identity.id)} · {live} live · {identity.keys.length} total
                    </span>
                    <span className="entry__role">
                      {identity.disabled_at ? (
                        <SealChip state="suspended">Disabled</SealChip>
                      ) : identity.auto_approve ? (
                        <SealChip state="signed">{identity.role} · trusted</SealChip>
                      ) : (
                        <span className="role">{identity.role}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="detail" aria-label="Selected holder">
          {issued && <CredentialTag issued={issued} onDismiss={() => setIssued(undefined)} />}

          {issuing && (
            <IssueForm
              name={name}
              role={role}
              keyLabel={keyLabel}
              pending={pending}
              error={error}
              onName={setName}
              onRole={setRole}
              onKeyLabel={setKeyLabel}
              onCancel={() => setIssuing(false)}
              onSubmit={submit}
            />
          )}

          {!issuing && selected && (
            <Holder
              identity={selected}
              onReload={reload}
              onIssue={async (keyLabel) => {
                const result = await issueCredential({
                  data: { identityId: selected.id, keyLabel },
                });
                setIssued(result);
                await reload();
              }}
              onAmend={async (amendment) => {
                await updateIdentity({ data: { identityId: selected.id, ...amendment } });
                await reload();
              }}
              onSetDisabled={async (disabled) => {
                await setIdentityDisabled({ data: { identityId: selected.id, disabled } });
                await reload();
              }}
            />
          )}

          {!issuing && !selected && !issued && status.state === "ready" && (
            <p className="empty prose">
              Select a holder from the register to see their credentials and
              custody line, or issue a new identity.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* The one-time reveal. The secret is readable for exactly as long as this tag
   is on the bench; dismissing it drops the credential to the stub, which is
   all the database keeps. */
function CredentialTag({ issued, onDismiss }: { issued: Issued; onDismiss: () => void }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "unavailable">("idle");

  /* The clipboard API is absent on insecure origins, and the documented
     default deployment is plain HTTP with Caddy optional. Never report a copy
     that did not happen — the user would redact a secret they never captured. */
  async function copySecret() {
    const ok = await navigator.clipboard
      ?.writeText(issued.key)
      .then(() => true)
      .catch(() => false);
    setCopy(ok ? "copied" : "unavailable");
    if (!ok) {
      const node = document.getElementById("credential-secret");
      if (node) getSelection()?.selectAllChildren(node);
    }
  }

  return (
    <div className="credential" role="status">
      <div className="credential__head">
        <span className="credential__punch" aria-hidden />
        <span className="label">Read once</span>
      </div>

      <button
        type="button"
        id="credential-secret"
        className="credential__secret"
        aria-label="Copy credential to clipboard"
        onClick={copySecret}
      >
        {issued.key}
      </button>

      <div className="credential__foot">
        <p className="credential__note">
          {copy === "copied"
            ? "Copied to clipboard."
            : copy === "unavailable"
              ? "Clipboard unavailable over http — the key is selected, copy it manually before redacting."
              : "Click to copy. It is not stored and cannot be shown again."}
        </p>
        <button type="button" className="credential__dismiss" onClick={onDismiss}>
          Redact
        </button>
      </div>
    </div>
  );
}

function IssueForm({
  name,
  role,
  keyLabel,
  pending,
  error,
  onName,
  onRole,
  onKeyLabel,
  onCancel,
  onSubmit,
}: {
  name: string;
  role: Role;
  keyLabel: string;
  pending: boolean;
  error?: string;
  onName: (value: string) => void;
  onRole: (value: Role) => void;
  onKeyLabel: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="bench__head">
        <div>
          <span className="label">New holder</span>
          <h2>Issue identity</h2>
        </div>
      </div>

      <div className="bench__section bench__form">
        <label className={`field${error ? " field--error" : ""}`}>
          <span className="label">Holder name</span>
          <input
            required
            aria-invalid={error ? true : undefined}
            value={name}
            onChange={(event) => onName(event.target.value)}
            placeholder="Claude Code — billing"
          />
        </label>

        <label className="field">
          <span className="label">Role</span>
          <select value={role} onChange={(event) => onRole(event.target.value as Role)}>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className={`field${error ? " field--error" : ""}`}>
          <span className="label">Credential label</span>
          <input
            required
            aria-invalid={error ? true : undefined}
            value={keyLabel}
            onChange={(event) => onKeyLabel(event.target.value)}
            placeholder="Ada's local Claude Code"
          />
        </label>

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}

        <div className="bench__controls">
          <button className="btn btn--primary" disabled={pending}>
            {pending ? "Issuing…" : "Issue identity and credential"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

type Amendment = { name: string; role: Role; description: string | null; autoApprove: boolean };

function Holder({
  identity,
  onReload,
  onIssue,
  onAmend,
  onSetDisabled,
}: {
  identity: Identity;
  onReload: () => Promise<void>;
  onIssue: (keyLabel: string) => Promise<void>;
  onAmend: (amendment: Amendment) => Promise<void>;
  onSetDisabled: (disabled: boolean) => Promise<void>;
}) {
  const [arming, setArming] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [amend, setAmend] = useState<Amendment>();
  const [armDisable, setArmDisable] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string>();
  const [amendPending, setAmendPending] = useState(false);
  const [amendError, setAmendError] = useState<string>();
  const [newLabel, setNewLabel] = useState("");
  const [issuePending, setIssuePending] = useState(false);
  const [issueError, setIssueError] = useState<string>();
  const [voiding, setVoiding] = useState<string>();
  const [failed, setFailed] = useState<{ id: string; message: string }>();
  const line = custodyLine(identity);

  async function void_(keyId: string) {
    setVoiding(keyId);
    setFailed(undefined);
    try {
      await revokeKey({ data: { keyId } });
      setArming(undefined);
      await onReload();
    } catch {
      setFailed({
        id: keyId,
        message: "The credential is still live — it could not be voided. Try again.",
      });
    } finally {
      setVoiding(undefined);
    }
  }

  async function addCredential(event: React.FormEvent) {
    event.preventDefault();
    setIssuePending(true);
    setIssueError(undefined);
    try {
      await onIssue(newLabel);
      setNewLabel("");
      setAdding(false);
    } catch (cause) {
      setIssueError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was issued — try again.`
          : "The credential could not be issued. Nothing was issued — try again.",
      );
    } finally {
      setIssuePending(false);
    }
  }

  async function saveAmendment(event: React.FormEvent) {
    event.preventDefault();
    if (!amend) return;
    setAmendPending(true);
    setAmendError(undefined);
    try {
      await onAmend(amend);
      setAmend(undefined);
    } catch (cause) {
      setAmendError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was changed — try again.`
          : "The record could not be saved. Nothing was changed — try again.",
      );
    } finally {
      setAmendPending(false);
    }
  }

  async function setDisabled(disabled: boolean) {
    setTogglePending(true);
    setToggleError(undefined);
    try {
      await onSetDisabled(disabled);
      setArmDisable(false);
    } catch (cause) {
      setToggleError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was changed — try again.`
          : "The holder's state could not be changed. Nothing was changed — try again.",
      );
    } finally {
      setTogglePending(false);
    }
  }

  const live = identity.keys.filter((key) => !key.revokedAt).length;
  const disabled = Boolean(identity.disabled_at);

  if (amend) {
    return (
      <form onSubmit={saveAmendment}>
        <div className="bench__head">
          <div>
            <span className="label">Editing · {accessionOf(identity.id)}</span>
            <h2>{identity.name}</h2>
          </div>
        </div>

        <div className="bench__section bench__form">
          <label className={`field${amendError ? " field--error" : ""}`}>
            <span className="label">Holder name</span>
            <input
              required
              autoFocus
              aria-invalid={amendError ? true : undefined}
              value={amend.name}
              onChange={(event) => setAmend({ ...amend, name: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="label">Role</span>
            <select
              value={amend.role}
              onChange={(event) => setAmend({ ...amend, role: event.target.value as Role })}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {amend.role !== identity.role && (
            <p className="amend__consequence">
              Every credential this holder owns changes from{" "}
              <span className="role">{identity.role}</span> to{" "}
              <span className="role">{amend.role}</span> the moment this is saved.
            </p>
          )}

          <label className="field">
            <span className="label">Submissions</span>
            <select
              value={amend.autoApprove ? "auto" : "review"}
              onChange={(event) =>
                setAmend({ ...amend, autoApprove: event.target.value === "auto" })
              }
            >
              <option value="review">Held for review</option>
              <option value="auto">Approved automatically</option>
            </select>
          </label>

          {amend.autoApprove !== identity.auto_approve && (
            <p className="amend__consequence">
              {amend.autoApprove
                ? "Everything this holder submits or revises will be marked approved without a human reading it. Canonical still requires a person."
                : "Future submissions from this holder will queue for review again. Sources already approved keep their authority."}
            </p>
          )}

          <label className="field">
            <span className="label">Administrator note</span>
            <input
              value={amend.description ?? ""}
              onChange={(event) =>
                setAmend({ ...amend, description: event.target.value || null })
              }
              placeholder="What this holder is for. Not shown to agents."
            />
          </label>

          {amendError && (
            <p className="notice" role="alert">
              {amendError}
            </p>
          )}

          <div className="bench__controls">
            <button className="btn btn--primary" disabled={amendPending}>
              {amendPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={amendPending}
              onClick={() => {
                setAmend(undefined);
                setAmendError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="bench__head">
        <div>
          <span className="label">
            Holder · {accessionOf(identity.id)} · registered {stamp(identity.created_at)}
          </span>
          <h2>{identity.name}</h2>
        </div>
        <div className="bench__seal">
          {disabled && (
            <SealChip state="suspended">Disabled {stamp(identity.disabled_at)}</SealChip>
          )}
          {identity.auto_approve && <SealChip state="signed">Trusted</SealChip>}
          <span className="role">{identity.role}</span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() =>
              setAmend({
                name: identity.name,
                role: identity.role,
                description: identity.description,
                autoApprove: identity.auto_approve,
              })
            }
          >
            Edit
          </button>

          {disabled ? (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={togglePending}
              onClick={() => void setDisabled(false)}
            >
              {togglePending ? "Enabling…" : "Enable"}
            </button>
          ) : armDisable ? (
            <>
              <button
                type="button"
                className="btn btn--void"
                disabled={togglePending}
                onClick={() => void setDisabled(true)}
              >
                {togglePending ? "Disabling…" : "Confirm disable"}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={togglePending}
                onClick={() => setArmDisable(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--void" onClick={() => setArmDisable(true)}>
              Disable
            </button>
          )}
        </div>
      </div>

      {armDisable && !disabled && (
        <p className="bench__consequence">
          Disabling refuses {live} live credential{live === 1 ? "" : "s"} at{" "}
          <code className="register">/mcp</code> immediately. Nothing is voided,
          and it can be undone.
        </p>
      )}

      {toggleError && (
        <p className="notice" role="alert">
          {toggleError}
        </p>
      )}

      {identity.description && <p className="bench__note prose">{identity.description}</p>}

      <div className="bench__section">
        <div className="bench__section-head">
          <span className="label">
            Credentials · {live} live of {identity.keys.length}
          </span>
          {!adding && (
            <button type="button" className="btn btn--quiet" onClick={() => setAdding(true)}>
              Issue credential
            </button>
          )}
        </div>

        {adding && (
          <form className="bench__inline" onSubmit={addCredential}>
            <label className={`field${issueError ? " field--error" : ""}`}>
              <span className="label">Credential label</span>
              <input
                required
                autoFocus
                aria-invalid={issueError ? true : undefined}
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="Ada's laptop — replacement"
              />
            </label>
            <div className="bench__controls">
              <button className="btn btn--primary" disabled={issuePending}>
                {issuePending ? "Issuing…" : "Issue"}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={issuePending}
                onClick={() => {
                  setAdding(false);
                  setIssueError(undefined);
                }}
              >
                Cancel
              </button>
            </div>
            {issueError && (
              <p className="notice" role="alert">
                {issueError}
              </p>
            )}
          </form>
        )}

        {identity.keys.length === 0 ? (
          !adding && (
            <p className="empty">
              This holder has no credentials. Issue one to let an agent present
              it at <code className="register">/mcp</code>.
            </p>
          )
        ) : (
          <div className="stubs">
            {identity.keys.map((key) => (
              <div className="stub" key={key.id}>
                <span className="stub__label">{labelOf(key)}</span>
                <span className="stub__meta register">
                  <b>{key.prefix}…</b> · issued {stamp(key.createdAt)} · last presented{" "}
                  {key.lastUsedAt ? stamp(key.lastUsedAt) : "never"}
                </span>
                <span className="stub__action">
                  {key.revokedAt ? (
                    <SealChip state="void">Void {stamp(key.revokedAt)}</SealChip>
                  ) : arming === key.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--void btn--sm"
                        disabled={voiding === key.id}
                        onClick={() => void void_(key.id)}
                      >
                        {voiding === key.id ? "Voiding…" : "Confirm void"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        disabled={voiding === key.id}
                        onClick={() => setArming(undefined)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--void btn--sm"
                      onClick={() => setArming(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </span>
                {failed?.id === key.id && (
                  <p className="notice stub__notice" role="alert">
                    {failed.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bench__section">
        <span className="label">Custody line</span>
        <ul className="line register">
          {line.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time dateTime={entry.at}>{stampAt(entry.at)}</time>
              <span>{entry.what}</span>
            </li>
          ))}
        </ul>
        <p className="line__caption">
          Derived from credential timestamps. The append-only event log is not
          yet reachable from the browser.
        </p>
      </div>
    </>
  );
}
