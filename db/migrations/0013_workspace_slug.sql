-- The MCP process selects an OKF bundle by workspace slug. The admin migration
-- chain already owns this column for browser routes; it also belongs here now
-- because MCP reads it directly from the shared workspace table.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug text;
UPDATE workspaces
SET slug = trim(both '-' FROM lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
WHERE slug IS NULL;
ALTER TABLE workspaces ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_unique ON workspaces (slug);
