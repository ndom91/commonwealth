import { createContext, useState } from 'react';
import type { Role } from '../lib/roles.js';

/* Shared between the identity register and the holder bench, which are separate
   routes now that a holder is addressable by URL. Types, the custody-line
   derivation and the one-time credential reveal all sit on the boundary between
   the two, so they live here rather than being imported across routes.
 *
 * The role vocabulary is *not* one of them. It used to be redeclared here, which
 * made three copies of a four-word list whose whole point is that there is one:
 * `roles.ts` says so in its opening paragraph, and explains that the copy in
 * `mcp-server/src/access-service.ts` is unavoidable only because that is a separate deploy
 * unit. This one was avoidable — `chrome.tsx` has always imported `Role` from
 * `roles.ts`, so it was never a client-bundle problem, just an old habit. */

export type Credential = {
  id: string;
  prefix: string;
  /* Null for credentials not issued through this UI — an imported key has no
     managed_api_key row to carry a label. */
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type Identity = {
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
  /* The person whose agent this is, and their display name. Both null for a
     shared holder — the bootstrap identity, a CI runner — which is a real state
     and not a missing value. Removing the owner from the project voids this
     holder's credentials and disables it; an unowned one survives.
   *
   * Never read by the MCP layer. `access-service.ts` resolves a key to a
   * project, a role and a trust flag, and ownership is none of those. */
  owner_admin_id: string | null;
  owner: string | null;
  keys: Credential[];
};

export type Issued = { identityId: string; key: string; prefix: string };

export const IdentityRevealContext = createContext<{
  issued: Issued | undefined;
  mcpUrl: string | null;
  redactIssued: () => void;
} | null>(null);

export const labelOf = (key: Credential) => key.label?.trim() || `Unlabelled · ${key.prefix}`;

/* Only immutable moments belong on the line: the holder's registration, and
   each credential's issue and void. `lastUsedAt` is a mutable column, not an
   event — putting it here would make the line rewrite itself every time an
   agent presented the key, so it stays on the credential stub instead. */
export function custodyLine(identity: Identity) {
  const entries: Array<{ at: string; what: string }> = [
    { at: identity.created_at, what: 'Holder registered' },
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

/* The one-time reveal. The secret is readable for exactly as long as this tag
   is on the bench; dismissing it drops the credential to the stub, which is
   all the database keeps. */
export function CredentialTag({
  issued,
  mcpUrl,
  onDismiss,
}: {
  issued: Issued;
  mcpUrl: string | null;
  onDismiss: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'secret' | 'config' | 'unavailable'>('idle');
  const endpoint = mcpUrl || new URL('/mcp', window.location.origin).toString();
  const config = JSON.stringify(
    {
      commonwealth: {
        baseUrl: endpoint,
        headers: { Authorization: `Bearer ${issued.key}` },
      },
    },
    null,
    2
  );

  /* The clipboard API is absent on insecure origins. Never report a copy that
       did not happen — the user would redact a secret they never captured. */
  async function copyValue(value: string, copied: 'secret' | 'config', id: string) {
    const ok = await navigator.clipboard
      ?.writeText(value)
      .then(() => true)
      .catch(() => false);
    setCopyState(ok ? copied : 'unavailable');
    if (!ok) {
      const node = document.getElementById(id);
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
        onClick={() => void copyValue(issued.key, 'secret', 'credential-secret')}
      >
        {issued.key}
      </button>

      <figure className="credential__config">
        <figcaption>
          <span className="label">MCP server configuration</span>
          <button
            type="button"
            className="credential__copy"
            onClick={() => void copyValue(config, 'config', 'credential-config')}
          >
            {copyState === 'config' ? 'Copied' : 'Copy config'}
          </button>
        </figcaption>
        <pre id="credential-config">
          <code>{config}</code>
        </pre>
      </figure>

      <div className="credential__foot">
        <p className="credential__note">
          {copyState === 'secret'
            ? 'Credential copied to clipboard.'
            : copyState === 'config'
              ? 'MCP configuration copied to clipboard.'
              : copyState === 'unavailable'
                ? 'Clipboard unavailable over http — the selected value can be copied manually before redacting.'
                : 'Click to copy. It is not stored and cannot be shown again.'}
        </p>
        <button type="button" className="credential__dismiss" onClick={onDismiss}>
          Redact
        </button>
      </div>
    </div>
  );
}
