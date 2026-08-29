import { createServerFn } from '@tanstack/react-start';
import { requireMember, type Scoped, validateProject, validateScope } from './authorize.js';
import { client } from './db.js';
import { fileEvent } from './events.js';
import { isRole, type Role } from './roles.js';

/* People — the humans who can sign in, and what each of them may do.
 *
 * Distinct from the identities above: those are agent holders in the knowledge
 * schema (`users`, uuid), these are better-auth accounts (`"user"`, text) with
 * a row in `member`. The two never mix, which is why the register can show a
 * holder called "Admin" that is nobody's colleague.
 *
 * They do share a role vocabulary, deliberately — see `roles.ts`. A human
 * writer and an agent writer are granted the same four verbs. */
export type Person = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  isYou: boolean;
  /* What removing them would retire: the agent holders they own here that are
     still in service, and the credentials still live against those holders.
     Counted so the confirmation can state the cost before it is paid — a
     removal that silently kills a bot is how a corpus goes quiet. Already
     disabled holders and already voided keys are excluded; they are not about
     to be taken out of service. */
  holders: number;
  liveCredentials: number;
};

/* Unpaginated on purpose, unlike `listIdentities`. These are people with a
   password to this instance; if that list ever needs a cursor, something has
   gone wrong that pagination would only hide. */
export const listPeople = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }): Promise<Person[]> => {
    const { userId: you, projectId } = await requireMember('admin', data.project);
    /* `created_at` comes back as a string, not a Date. `drizzle()` mutates the
     client it is handed (see `db.ts`) and that extends to its date parsers, so
     this client hands back raw Postgres timestamps while a bare postgres.js
     client would give you a Date. Pass it through untouched: `<Stamp>` takes
     either shape and normalises it, which is what every register here does. */
    const rows = await client<
      {
        id: string;
        name: string;
        email: string;
        role: string;
        created_at: string;
        holders: string;
        live_credentials: string;
      }[]
    >`
    SELECT "user".id, "user".name, "user".email, member.role, member.created_at,
      (SELECT count(*) FROM users
        WHERE users.project_id = member.project_id
          AND users.owner_admin_id = "user".id
          AND users.disabled_at IS NULL) AS holders,
      (SELECT count(*) FROM api_keys
        JOIN users ON users.id = api_keys.user_id
        WHERE users.project_id = member.project_id
          AND users.owner_admin_id = "user".id
          AND api_keys.revoked_at IS NULL) AS live_credentials
    FROM member
    JOIN "user" ON "user".id = member.user_id
    WHERE member.project_id = ${projectId}
    ORDER BY member.created_at ASC, "user".email ASC
  `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: isRole(row.role) ? row.role : 'reader',
      createdAt: row.created_at,
      isYou: row.id === you,
      /* `count(*)` is a bigint, and postgres.js hands those back as strings so
         a value past 2^53 is not quietly rounded. These are small. */
      holders: Number(row.holders),
      liveCredentials: Number(row.live_credentials),
    }));
  });

/* Raising or lowering what someone may do.
 *
 * The last-administrator guard is the point of the transaction: without it,
 * demoting yourself when you are the only admin locks the instance out of its
 * own people register, credentials and review queue, with no way back through
 * the browser. Counted inside the same transaction as the update so two
 * simultaneous demotions cannot both see a second admin that is about to
 * disappear. */
export const updatePersonRole = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ userId: string; role: Role }> => {
    const input = (value ?? {}) as Partial<{ userId: string; role: string }>;
    const userId = input.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    if (!isRole(input.role)) throw new Error('Invalid role');
    return { project: validateProject(value), userId, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [before] = await transaction<{ role: string }[]>`
        SELECT role FROM member
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
        FOR UPDATE
      `;
      if (!before) throw new Error('That person is no longer a member.');
      if (before.role === data.role) return;
      if (before.role === 'admin' && data.role !== 'admin') {
        const [{ count }] = await transaction<{ count: string }[]>`
          SELECT count(*) FROM member
          WHERE project_id = ${projectId} AND role = 'admin'
        `;
        if (Number(count) <= 1) {
          throw new Error('This is the only administrator. Promote someone else first.');
        }
      }
      await transaction`
        UPDATE member SET role = ${data.role}
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
      `;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'member_role_changed',
        metadata: { userId: data.userId, from: before.role, to: data.role },
      });
    });
    return { role: data.role };
  });

/* Removing someone's access, and retiring the agents they held.
 *
 * The membership goes; the account and its attributable history stay. Deleting
 * the account would quietly unattribute its concept commits — which is the
 * opposite of what a provenance product should do when someone leaves.
 *
 * Their *credentials* are a different question, and the answer is that they
 * stop working. A key outliving the person it was minted for is an agent
 * reading a corpus nobody on it is answerable for. Anything shared that breaks
 * as a result is an administrator's to re-issue, deliberately, under a holder
 * that is not one person's.
 *
 * "Retired" here means voided and disabled, not deleted. The `users` row cannot
 * be deleted — `events.actor_admin_id` and `api_keys.user_id` reference it with
 * no `ON DELETE` clause, so a delete raises a foreign-key violation for any
 * holder with recorded activity. That is the schema agreeing with Principle 2:
 * nothing here may make history unrecoverable. Voiding the secrets achieves what
 * deletion was wanted for; the row stays so the corpus keeps its provenance. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ userId: string }> => {
    const userId = (value as { userId?: string })?.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    return { project: validateProject(value), userId };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    if (data.userId === actor) throw new Error('You cannot remove your own access.');
    let retired = { holders: 0, credentials: 0 };
    await client.begin(async (transaction) => {
      const [removed] = await transaction<{ role: string }[]>`
        DELETE FROM member
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
        RETURNING role
      `;
      /* Already gone. The register reloads without them and there is nothing
         for the administrator to correct. */
      if (!removed) return;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'member_removed',
        metadata: { userId: data.userId, role: removed.role },
      });

      /* Scoped to the project being left, so holders this person owns in a
         project they are still a member of keep working. The scope rides in
         through the holder in the same statement as the void, so a key in
         another project is never voided and then found to be foreign. */
      const voided = await transaction<{ id: string; user_id: string; key_prefix: string }[]>`
        UPDATE api_keys SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND user_id IN (
            SELECT id FROM users
            WHERE project_id = ${projectId} AND owner_admin_id = ${data.userId}
          )
        RETURNING id, user_id, key_prefix
      `;
      /* Both, not either. Voiding kills the secrets and cannot be undone;
         disabling is the gate `AccessService` checks on every presentation, and
         covers any key minted against the holder between now and someone
         noticing. */
      const disabled = await transaction<{ id: string }[]>`
        UPDATE users SET disabled_at = now()
        WHERE project_id = ${projectId} AND owner_admin_id = ${data.userId}
          AND disabled_at IS NULL
        RETURNING id
      `;
      retired = { holders: disabled.length, credentials: voided.length };

      for (const key of voided) {
        const [managed] = await transaction<{ label: string }[]>`
          SELECT label FROM managed_api_key WHERE id = ${key.id}
        `;
        await fileEvent(transaction, {
          projectId,
          actor,
          type: 'api_key_revoked',
          metadata: {
            identityId: key.user_id,
            keyId: key.id,
            prefix: key.key_prefix,
            label: managed?.label ?? null,
          },
        });
      }
      /* Filed per holder and marked `offboarded`, which is what tells the
         activity log to treat this disable as notable. An administrator
         disabling a holder by hand is reversible and stays quiet; this one is
         not, and a log that under-reports it is describing a project that did
         not happen. */
      for (const holder of disabled) {
        await fileEvent(transaction, {
          projectId,
          actor,
          type: 'identity_disabled',
          metadata: { identityId: holder.id, reason: 'offboarded', ownerId: data.userId },
        });
      }
    });
    return { removed: true, retired };
  });
