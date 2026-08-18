import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

/* better-auth's `organization`, remapped onto the workspace table the knowledge
   side already scopes everything to (`concepts`, `concept_chunks`, `users`,
   `events` and `index_configuration` all carry `workspace_id`). Declared here so the drizzle
   adapter can reach it; the remapping itself is in `lib/auth.ts`.

   `slug`, `logo` and `metadata` are the plugin's, not ours. Only `slug` is
   required by it. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

/* Who may act, and how much. Replaces `admin_role`, which had no role column
   and so made everyone who could sign in an administrator.

    The four roles are the agent vocabulary from `mcp-server/src/access-service.ts`, not
   better-auth's `owner | admin | member`. One vocabulary for people and agents
   means `reader | writer | reviewer | admin` has a single definition. */
export const member = pgTable('member', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* better-auth's invitation: adding someone who **already has an account** to a
   workspace. Unused so far — see `memberInvitation` for the flow that runs
   today — but its endpoints are live routes, so the table has to exist for a
   permission refusal not to arrive as a 500. */
export const invitation = pgTable('invitation', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* Ours: a single-use, expiring authorisation to create one named account at one
   role. Not better-auth's, because its `acceptInvitation` requires the invitee
   to hold an account already and the whole point is the person who does not.

   Read and written with raw SQL in `lib/management.ts` like the rest of the
   domain; declared here so drizzle-kit sees the whole schema. */
export const memberInvitation = pgTable('member_invitation', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  invitedBy: text('invited_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const managedApiKey = pgTable('managed_api_key', {
  id: uuid('id').primaryKey(),
  userId: uuid('knowledge_user_id').notNull(),
  label: text('label').notNull(),
  createdByAdminId: text('created_by_admin_id').references(() => user.id),
  expiresAt: timestamp('expires_at'),
});
