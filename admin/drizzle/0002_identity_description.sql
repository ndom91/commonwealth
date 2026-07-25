-- An administrator's note on what a knowledge identity is for: which agent
-- holds it, which surface it serves, why it has the role it has. Nullable and
-- additive; existing rows are unaffected.
--
-- Scope: internal to the admin surface. It is deliberately not read by the MCP
-- layer and is never returned to an agent.
ALTER TABLE "users" ADD COLUMN "description" text;
