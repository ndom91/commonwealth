-- A revision may now be written by a human administrator instead of an agent,
-- so `created_by` — a foreign key to the agent `users` table — is no longer
-- required.
--
-- Only the nullability change belongs in this chain. The administrator's own id
-- lives in `created_by_admin_id`, a foreign key to better-auth's "user" table,
-- and that table does not exist here; see AGENTS.md on why the two chains
-- diverge. What this chain must carry is anything the MCP server's own queries
-- depend on, and they read `source_revisions` on every retrieval.
ALTER TABLE source_revisions ALTER COLUMN created_by DROP NOT NULL;
