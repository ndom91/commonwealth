import type { TransactionSql } from 'postgres';

/* Filing a row on the custody line.
 *
 * The concept and management call sites used to write this INSERT by hand. The
 * statement is not complicated; the reason to have it once is that
 * three separate things about it are easy to get quietly wrong, and getting any
 * of them wrong produces a row that looks fine.
 *
 * **The handle.** The parameter is `TransactionSql`, not `Sql`, and that is
 * load-bearing rather than decorative. AGENTS.md's *Fragments must come from the
 * handle that runs them*: inside a `client.begin()` block, something built from
 * the pooled `client` runs, writes nothing where it was used, and reports
 * success. Because `Sql` has no `savepoint`, it is not assignable here, so
 * handing this the pool instead of the transaction is a compile error rather
 * than a silent no-op. Every event belongs in the same transaction as the thing
 * it records anyway — a custody line that can disagree with the object it
 * describes is worse than no custody line.
 *
 * **The jsonb.** `${JSON.stringify(x)}::jsonb` is correct on the admin's client
 * and *wrong* on the MCP server's, which needs `sql.json(x)`; see the long note
 * in `db.ts`. Stating it once means the inverted convention has one place to be
 * remembered instead of twenty.
 *
 * **The actor column.** `actor_admin_id` references `"user"` — a person who
 * signed in. `actor_id` references `users`, an agent holding a credential, and
 * is the MCP server's to write. Nothing in the admin should ever fill the second
 * one, so this does not offer it.
 *
 * `event_type` is an unconstrained `text` column, so the union below is the only
 * thing standing between a typo and a row that renders as "source submited"
 * forever. It lists what the *admin* writes; the MCP server also writes
 * `search`, and `activity.tsx` phrases both plus anything unmapped. */
export type EventType =
  | 'concept_created'
  | 'concept_revised'
  | 'concept_verified'
  | 'concept_deprecated'
  | 'api_key_created'
  | 'api_key_revoked'
  | 'identity_amended'
  | 'identity_disabled'
  | 'identity_enabled'
  | 'member_invited'
  | 'member_invitation_revoked'
  | 'member_joined'
  | 'member_added'
  | 'member_role_changed'
  | 'member_removed'
  | 'workspace_created'
  | 'workspace_renamed'
  | 'workspace_archived'
  | 'workspace_restored';

export type Event = {
  workspaceId: string;
  /* The signed-in person who acted. Null only where no account is responsible —
     redeeming an invitation files its own arrival before the actor exists as a
     member. */
  actor: string | null;
  type: EventType;
  metadata?: Record<string, unknown>;
};

export async function fileEvent(sql: TransactionSql, event: Event): Promise<void> {
  await sql`
    INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
    VALUES (
      ${event.workspaceId},
      ${event.actor},
      ${event.type},
      ${JSON.stringify(event.metadata ?? {})}::jsonb
    )
  `;
}
