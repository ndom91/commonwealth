import { createHash, randomBytes } from 'node:crypto';
import { clientIp, FixedWindow } from '@commonwealth/rate-limit';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { provisioning } from './auth.js';
import { requireMember, type Scoped, validateProject, validateScope } from './authorize.js';
import { client } from './db.js';
import { fileEvent } from './events.js';
import { isRole, type Role } from './roles.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Invitation = {
  id: string;
  email: string;
  name: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

/* Long enough to survive a weekend and a holiday Monday; short enough that a
   link forgotten in a chat log stops working. */
const INVITATION_DAYS = 7;

const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

/* Add a teammate without ever holding their password.
 *
 * This used to take an initial password, which the issuer typed, read off the
 * screen and passed along — then told the recipient to replace it. That
 * instruction was correct and was also an admission that the mechanism was
 * wrong. Now the issuer mints a single-use link and the recipient chooses a
 * password nobody else has seen.
 *
 * An address that already has an account takes the *add* branch: it needs no
 * password, so there is nothing to invite them to set. That branch is not only
 * a convenience. An invitation able to act on an existing account would be an
 * account-takeover primitive — invite a colleague's address, redeem it
 * yourself, own their login. This check and the matching one in
 * `acceptInvitation` are what make that impossible.
 *
 * Sign-up stays closed throughout. `provisioning` (see `auth.ts`) is the only
 * thing that creates accounts, and the public `POST /api/auth/sign-up/email`
 * route keeps refusing. */
export const invitePerson = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ name: string; email: string; role: Role }> => {
    const input = (value ?? {}) as Partial<{ name: string; email: string; role: string }>;
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!name) throw new Error('A name is required.');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error('That does not look like an email address.');
    /* No default. The inviter decides what this person may do, every time —
       a role that arrives by omission is one nobody chose. */
    if (!isRole(input.role)) throw new Error('Choose a role for this person.');
    return { project: validateProject(value), name, email, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: invitedBy, projectId } = await requireMember('admin', data.project);

    const [existing] = await client<
      { id: string }[]
    >`SELECT id FROM "user" WHERE lower(email) = ${data.email}`;
    if (existing) {
      const [already] = await client<{ role: string }[]>`
        SELECT role FROM member
        WHERE project_id = ${projectId} AND user_id = ${existing.id}
      `;
      if (already) throw new Error(`${data.email} is already a member of this project.`);
      await client.begin(async (transaction) => {
        await transaction`
          INSERT INTO member (project_id, user_id, role)
          VALUES (${projectId}, ${existing.id}, ${data.role})
          ON CONFLICT (project_id, user_id) DO NOTHING
        `;
        await fileEvent(transaction, {
          projectId,
          actor: invitedBy,
          type: 'member_added',
          metadata: { email: data.email, role: data.role },
        });
      });
      return { email: data.email, added: true, role: data.role, token: null as string | null };
    }

    const token = `inv_${randomBytes(32).toString('base64url')}`;
    await client.begin(async (transaction) => {
      /* Supersede this project's outstanding link for the address rather
         than collide with the partial unique index. Re-inviting should mean
         "here is a fresh link", not an error about one they never used.

         Scoped, and the index is scoped with it (0009): superseding every live
         invitation for the address would let one project cancel another's,
         which is the same person's invitation to a corpus this admin cannot
         even see. */
      await transaction`
        UPDATE member_invitation SET revoked_at = now()
        WHERE project_id = ${projectId} AND lower(email) = ${data.email}
          AND accepted_at IS NULL AND revoked_at IS NULL
      `;
      await transaction`
        INSERT INTO member_invitation (email, name, token_hash, project_id, role, invited_by, expires_at)
        VALUES (${data.email}, ${data.name}, ${tokenDigest(token)}, ${projectId}, ${data.role},
                ${invitedBy}, now() + ${`${INVITATION_DAYS} days`}::interval)
      `;
      await fileEvent(transaction, {
        projectId,
        actor: invitedBy,
        type: 'member_invited',
        metadata: { email: data.email, role: data.role },
      });
    });

    return { email: data.email, added: false, role: data.role, token: token as string | null };
  });

/* A pending invitation is a live credential to this surface, so it has to be
   visible and cancellable. Expired ones stay listed: knowing a link went unused
   is the difference between chasing someone and reissuing. */
export const listInvitations = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }): Promise<Invitation[]> => {
    const { projectId } = await requireMember('admin', data.project);
    const rows = await client<
      {
        id: string;
        email: string;
        name: string;
        role: string;
        invited_by: string;
        created_at: string;
        expires_at: string;
        expired: boolean;
      }[]
    >`
      SELECT invitation.id, invitation.email, invitation.name, invitation.role,
             COALESCE(NULLIF(inviter.name, ''), inviter.email, 'an administrator') AS invited_by,
             invitation.created_at, invitation.expires_at,
             invitation.expires_at <= now() AS expired
      FROM member_invitation AS invitation
      LEFT JOIN "user" AS inviter ON inviter.id = invitation.invited_by
      WHERE invitation.project_id = ${projectId}
        AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
      ORDER BY invitation.created_at DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: isRole(row.role) ? row.role : 'reader',
      invitedBy: row.invited_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: row.expired,
    }));
  });

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ invitationId: string }> => {
    const id = (value as { invitationId?: string })?.invitationId?.trim();
    if (!id || !UUID.test(id)) throw new Error('Invalid invitation');
    return { project: validateProject(value), invitationId: id };
  })
  .handler(async ({ data }) => {
    const { userId: revokedBy, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [revoked] = await transaction<{ email: string }[]>`
        UPDATE member_invitation SET revoked_at = now()
        WHERE id = ${data.invitationId} AND project_id = ${projectId}
          AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING email
      `;
      /* Already spent or already revoked. The list reloads without it; there is
         nothing for the administrator to correct. */
      if (!revoked) return;
      await fileEvent(transaction, {
        projectId,
        actor: revokedBy,
        type: 'member_invitation_revoked',
        metadata: { email: revoked.email },
      });
    });
    return { revoked: true };
  });

/* Every reason a link can fail, and the sentence for each.
 *
 * They are separated because they send the reader somewhere different: *used*
 * means go and sign in, *revoked* and *expired* mean go back to whoever invited
 * you, and *already has an account* means the link was never going to work.
 * Collapsing them into one message would tell someone with no account to sign
 * in — advice that cannot succeed.
 *
 * A token that was never issued gets the flattest sentence of the four, and
 * nothing distinguishes it from one aimed at a different instance. */
async function inspectInvitation(token: string) {
  const [invitation] = await client<
    {
      id: string;
      email: string;
      name: string;
      role: string;
      project_id: string;
      project_name: string;
      invited_by: string;
      expired: boolean;
      accepted: boolean;
      revoked: boolean;
    }[]
  >`
    SELECT invitation.id, invitation.email, invitation.name, invitation.role,
           invitation.project_id, project.name AS project_name,
           COALESCE(NULLIF(inviter.name, ''), inviter.email, 'an administrator') AS invited_by,
           invitation.expires_at <= now() AS expired,
           invitation.accepted_at IS NOT NULL AS accepted,
           invitation.revoked_at IS NOT NULL AS revoked
    FROM member_invitation AS invitation
    JOIN projects AS project ON project.id = invitation.project_id
    LEFT JOIN "user" AS inviter ON inviter.id = invitation.invited_by
    WHERE invitation.token_hash = ${tokenDigest(token)}
  `;
  if (!invitation) throw new Error('That invitation link is not valid.');
  if (invitation.accepted)
    throw new Error('That invitation has already been used. Sign in instead.');
  if (invitation.revoked)
    throw new Error('That invitation was withdrawn. Ask whoever invited you for a new link.');
  if (invitation.expired) throw new Error('That invitation has expired. Ask for a new link.');

  /* Checked here, not only at redemption, so the page refuses up front instead
     of showing a password form that cannot succeed. The address may have
     acquired an account since the link was minted — by the bootstrap script, or
     by another invitation — and a token able to set its password would be a
     takeover. `acceptInvitation` repeats the check rather than trusting this
     one; between the two calls is a window. */
  const [existing] = await client<
    { id: string }[]
  >`SELECT id FROM "user" WHERE lower(email) = ${invitation.email.toLowerCase()}`;
  if (existing) throw new Error(`${invitation.email} already has an account. Sign in instead.`);

  return invitation;
}

/* The two invitation routes are the only unauthenticated server functions in
 * the product, so they are the only ones needing a limiter of their own —
 * everything else is behind `requireMember`, which needs a session, and
 * better-auth limits the endpoints that mint one.
 *
 * **By address, and separately by token**, because neither alone is enough.
 *
 * By token alone is no limit at all against enumeration: every guess is a new
 * key, so every guess gets a fresh allowance.
 *
 * By address alone breaks a real case. With no proxy in front there is no
 * address to tell callers apart — `fallback` is a constant, so *everyone*
 * shares one bucket — and a team of fifteen redeeming their invitations the
 * morning they are sent would see the last five refused. An onboarding flow
 * that fails when onboarding works is not a limiter, it is an outage.
 *
 * So the address bucket is sized for a crowd and the token bucket is sized for
 * a person: enough retries to fix a fumbled password, not enough to sit on one
 * link. Neither is defending the token itself, which is 256 bits and is not
 * going to be guessed — they bound cost and nothing more.
 *
 * Reading is cheap, a digest and one indexed lookup, so it is allowed often.
 * Accepting is the expensive one — it creates an account and better-auth hashes
 * the password — but only ever on a *valid, unclaimed* token, which works
 * exactly once. A junk token is refused before any of that. */
const inviteReads = new FixedWindow({ window: 60, max: 60 });
const inviteAccepts = new FixedWindow({ window: 600, max: 60 });
const inviteAcceptsPerToken = new FixedWindow({ window: 600, max: 10 });

function forwardedIpHeader(): string {
  const configuredHeader = process.env.FORWARDED_IP_HEADER?.trim();
  if (configuredHeader) return configuredHeader;

  return 'x-forwarded-for';
}

function invitationCaller(): string {
  return clientIp((name) => getRequest().headers.get(name) ?? undefined, {
    fallback: 'unproxied',
    forwardedHeader: forwardedIpHeader(),
    trustForwarded: process.env.TRUST_FORWARDED_FOR === 'true',
  });
}

function refuse(retryAfter: number): never {
  throw new Error(`Too many attempts. Wait ${retryAfter} seconds and open the link again.`);
}

function refuseIfTooFast(limiter: FixedWindow): void {
  const decision = limiter.check(invitationCaller());
  if (!decision.ok) refuse(decision.retryAfter);
}

/* Hashed, so a token never becomes a map key held in memory in the clear. The
   same digest the row is stored under, so this costs nothing extra. */
function refuseIfTokenTooFast(token: string): void {
  const decision = inviteAcceptsPerToken.check(createHash('sha256').update(token).digest('hex'));
  if (!decision.ok) refuse(decision.retryAfter);
}

/* What the invite page shows before asking for a password: who invited you,
 * which address this is for, and what you will be able to do.
 *
 * Unauthenticated, necessarily — the reader has no account yet. */
export const readInvitation = createServerFn({ method: 'GET' })
  .validator((value: unknown): { token: string } => {
    const token = (value as { token?: string })?.token?.trim();
    if (!token) throw new Error('That invitation link is not valid.');
    return { token };
  })
  .handler(async ({ data }) => {
    refuseIfTooFast(inviteReads);
    const invitation = await inspectInvitation(data.token);
    return {
      email: invitation.email,
      name: invitation.name,
      role: isRole(invitation.role) ? invitation.role : ('reader' as Role),
      invitedBy: invitation.invited_by,
      /* Named on the page for the same reason the role is: an instance holds
         several corpora now, and which one you are being let into is the part
         that varies. */
      project: invitation.project_name,
    };
  });

/* Redeeming an invitation. **Not gated on `requireMember()`** — the holder has
 * no account yet, so there is no session to check. The token is the
 * authorisation, which is why it is 256 bits, single-use, expiring, and stored
 * only as a digest.
 *
 * `inspectInvitation` runs again here rather than trusting what the page was
 * told. Between rendering the form and submitting it, the link may have been
 * revoked, or that address may have acquired an account by another route — and
 * a token that could then set its password would be a takeover.
 *
 * The invitation is claimed with a conditional UPDATE *before* the account is
 * made, so two simultaneous redemptions cannot both pass; if account creation
 * then fails, the transaction rolls the claim back with it. */
export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator((value: unknown): { token: string; password: string } => {
    const input = (value ?? {}) as Partial<{ token: string; password: string }>;
    const token = input.token?.trim();
    if (!token) throw new Error('That invitation link is not valid.');
    /* Matches better-auth's `minPasswordLength` default, which is what actually
       enforces it — checking here only saves a round trip. */
    if (!input.password || input.password.length < 8) {
      throw new Error('Use at least 8 characters.');
    }
    return { token, password: input.password };
  })
  .handler(async ({ data }) => {
    refuseIfTooFast(inviteAccepts);
    refuseIfTokenTooFast(data.token);
    const invitation = await inspectInvitation(data.token);
    const email = invitation.email.toLowerCase();
    const role = isRole(invitation.role) ? invitation.role : ('reader' as Role);

    await client.begin(async (transaction) => {
      /* The one write in `web/src/lib` with no project predicate, and the
         only one that should not have: the row was found by token digest, so
         its project came from the invitation rather than from a caller. */
      const [claimed] = await transaction<{ id: string }[]>`
        UPDATE member_invitation SET accepted_at = now()
        WHERE id = ${invitation.id} AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id
      `;
      if (!claimed) throw new Error('That invitation has already been used. Sign in instead.');

      await provisioning.api.signUpEmail({
        body: { name: invitation.name, email: invitation.email, password: data.password },
      });
      const [created] = await transaction<{ id: string }[]>`
        SELECT id FROM "user" WHERE lower(email) = ${email}
      `;
      if (!created) throw new Error('The account could not be created. Nothing was changed.');
      await transaction`
        INSERT INTO member (project_id, user_id, role)
        VALUES (${invitation.project_id}, ${created.id}, ${role})
        ON CONFLICT (project_id, user_id) DO NOTHING
      `;
      await fileEvent(transaction, {
        projectId: invitation.project_id,
        actor: created.id,
        type: 'member_joined',
        metadata: { email: invitation.email, role },
      });
    });

    return { email: invitation.email, role, project: invitation.project_name };
  });
