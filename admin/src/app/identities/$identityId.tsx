import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { accessionOf, SealChip, stamp, stampAt } from '../../components/chrome.js';
import {
  CredentialTag,
  custodyLine,
  type Identity,
  type Issued,
  labelOf,
  ROLES,
  type Role,
} from '../../components/identity.js';
import {
  issueCredential,
  revokeKey,
  setIdentityDisabled,
  updateIdentity,
} from '../../lib/management.js';

export const Route = createFileRoute('/identities/$identityId')({
  component: HolderBench,
});

type Amendment = {
  name: string;
  role: Role;
  description: string | null;
  autoApprove: boolean;
};

function HolderBench() {
  const { identityId } = Route.useParams();
  const router = useRouter();

  /* Read from the register's loader rather than fetching again. The parent
     already holds every holder, and one `router.invalidate()` after a mutation
     refreshes the register, this bench and the rail count from a single
     round trip. */
  const { page } = useLoaderData({ from: '/identities' }) as {
    page: { identities: Identity[] } | undefined;
  };
  const identity = (page?.identities ?? []).find((entry) => entry.id === identityId);

  const [arming, setArming] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [amend, setAmend] = useState<Amendment>();
  const [armDisable, setArmDisable] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string>();
  const [amendPending, setAmendPending] = useState(false);
  const [amendError, setAmendError] = useState<string>();
  const [newLabel, setNewLabel] = useState('');
  const [issuePending, setIssuePending] = useState(false);
  const [issueError, setIssueError] = useState<string>();
  const [issued, setIssued] = useState<Issued>();
  const [voiding, setVoiding] = useState<string>();
  const [failed, setFailed] = useState<{ id: string; message: string }>();

  if (!identity) {
    /* The register is paginated, so a holder can be real but simply not on the
       page in view — a deep link to an older holder lands here. Say both
       possibilities rather than declaring the link dead. */
    return (
      <p className="empty prose">
        That holder is not on this page of the register. Page back through earlier holders to reach
        them, or check the link — they may have been removed.
      </p>
    );
  }

  const line = custodyLine(identity);
  const live = identity.keys.filter((key) => !key.revokedAt).length;
  const disabled = Boolean(identity.disabled_at);

  async function void_(keyId: string) {
    setVoiding(keyId);
    setFailed(undefined);
    try {
      await revokeKey({ data: { keyId } });
      setArming(undefined);
      await router.invalidate();
    } catch {
      setFailed({
        id: keyId,
        message: 'The credential is still live — it could not be voided. Try again.',
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
      setIssued(await issueCredential({ data: { identityId, keyLabel: newLabel } }));
      setNewLabel('');
      setAdding(false);
      await router.invalidate();
    } catch (cause) {
      setIssueError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was issued — try again.`
          : 'The credential could not be issued. Nothing was issued — try again.'
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
      await updateIdentity({ data: { identityId, ...amend } });
      setAmend(undefined);
      await router.invalidate();
    } catch (cause) {
      setAmendError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was changed — try again.`
          : 'The record could not be saved. Nothing was changed — try again.'
      );
    } finally {
      setAmendPending(false);
    }
  }

  async function setDisabled(next: boolean) {
    setTogglePending(true);
    setToggleError(undefined);
    try {
      await setIdentityDisabled({ data: { identityId, disabled: next } });
      setArmDisable(false);
      await router.invalidate();
    } catch (cause) {
      setToggleError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was changed — try again.`
          : "The holder's state could not be changed. Nothing was changed — try again."
      );
    } finally {
      setTogglePending(false);
    }
  }

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
          <label className={`field${amendError ? ' field--error' : ''}`}>
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
              Every credential this holder owns changes from{' '}
              <span className="role">{identity.role}</span> to{' '}
              <span className="role">{amend.role}</span> the moment this is saved.
            </p>
          )}

          <label className="field">
            <span className="label">Submissions</span>
            <select
              value={amend.autoApprove ? 'auto' : 'review'}
              onChange={(event) =>
                setAmend({
                  ...amend,
                  autoApprove: event.target.value === 'auto',
                })
              }
            >
              <option value="review">Held for review</option>
              <option value="auto">Approved automatically</option>
            </select>
          </label>

          {amend.autoApprove !== identity.auto_approve && (
            <p className="amend__consequence">
              {amend.autoApprove
                ? 'Everything this holder submits or revises will be marked approved without a human reading it. Canonical still requires a person.'
                : 'Future submissions from this holder will queue for review again. Sources already approved keep their authority.'}
            </p>
          )}

          <label className="field">
            <span className="label">Administrator note</span>
            <input
              value={amend.description ?? ''}
              onChange={(event) => setAmend({ ...amend, description: event.target.value || null })}
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
              {amendPending ? 'Saving…' : 'Save changes'}
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
      {issued && <CredentialTag issued={issued} onDismiss={() => setIssued(undefined)} />}

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
              {togglePending ? 'Enabling…' : 'Enable'}
            </button>
          ) : armDisable ? (
            <>
              <button
                type="button"
                className="btn btn--void"
                disabled={togglePending}
                onClick={() => void setDisabled(true)}
              >
                {togglePending ? 'Disabling…' : 'Confirm disable'}
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
          Disabling refuses {live} live credential{live === 1 ? '' : 's'} at{' '}
          <code className="register">/mcp</code> immediately. Nothing is voided, and it can be
          undone.
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
            <label className={`field${issueError ? ' field--error' : ''}`}>
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
                {issuePending ? 'Issuing…' : 'Issue'}
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
              This holder has no credentials. Issue one to let an agent present it at{' '}
              <code className="register">/mcp</code>.
            </p>
          )
        ) : (
          <div className="stubs">
            {identity.keys.map((key) => (
              <div className="stub" key={key.id}>
                <span className="stub__label">{labelOf(key)}</span>
                <span className="stub__meta register">
                  <b>{key.prefix}…</b> · issued {stamp(key.createdAt)} · last presented{' '}
                  {key.lastUsedAt ? stamp(key.lastUsedAt) : 'never'}
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
                        {voiding === key.id ? 'Voiding…' : 'Confirm void'}
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
      </div>
    </>
  );
}
