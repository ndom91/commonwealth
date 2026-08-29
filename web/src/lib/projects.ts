import { createServerFn } from '@tanstack/react-start';
import {
  requireArchivedAdmin,
  requireMember,
  type Scoped,
  SLUG,
  validateProject,
  validateScope,
} from './authorize.js';
import { client } from './db.js';
import { fileEvent } from './events.js';

/* A second corpus on one instance.
 *
 * Four things have to happen together, which is why this is a transaction and
 * why `allowUserToCreateOrganization` stays `false` on the plugin: its own
 * `organization/create` endpoint would do the first and leave the rest, giving
 * you a project with no members and no index configuration — reachable by
 * nobody and unable to accept a source.
 *
 * The index configuration is copied from the project you are standing in
 * rather than read from the environment. `concept_chunks.embedding` is
 * `vector(1024)` for the whole table and `EMBEDDING_MODEL` is one process-wide variable, so
 * every project on an instance necessarily shares a model; copying makes that
 * explicit and keeps `index_configuration`'s existing job — refusing a silent
 * model change — working per project.
 *
 * Any signed-in member may start another project. The current project only
 * supplies the instance-wide embedding configuration; it does not delegate
 * authority to create a project. */
export const createProject = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ name: string; slug: string }> => {
    const input = (value ?? {}) as Partial<{ name: string; slug: string }>;
    const name = input.name?.trim();
    if (!name) throw new Error('A project needs a name.');
    if (name.length > 120) throw new Error('That name is too long.');
    const slug = input.slug?.trim().toLowerCase();
    if (!slug || !SLUG.test(slug)) {
      throw new Error('A slug may hold lowercase letters, numbers and single hyphens.');
    }
    if (slug.length > 60) throw new Error('That slug is too long.');
    return { project: validateProject(value), name, slug };
  })
  .handler(async ({ data }) => {
    const { userId: creator, projectId: from } = await requireMember('read', data.project);

    /* Both columns are unique, so both are checked here. Without the name
       check the insert still refuses — with a raw `23505` naming a constraint,
       which is not a sentence to put in front of someone who mistyped. */
    const [taken] = await client<{ slug: string; name: string }[]>`
      SELECT slug, name FROM projects
      WHERE slug = ${data.slug} OR lower(name) = ${data.name.toLowerCase()}
    `;
    if (taken?.slug === data.slug) {
      throw new Error(`The slug “${data.slug}” is already in use.`);
    }
    if (taken) throw new Error(`A project called “${taken.name}” already exists.`);

    let created: string | undefined;
    await client.begin(async (transaction) => {
      const [project] = await transaction<{ id: string }[]>`
        INSERT INTO projects (name, slug) VALUES (${data.name}, ${data.slug})
        RETURNING id
      `;
      if (!project) throw new Error('That project could not be created.');
      created = project.id;
      await transaction`
        INSERT INTO member (project_id, user_id, role)
        VALUES (${project.id}, ${creator}, 'admin')
      `;
      /* `INSERT … SELECT` inserts nothing when the source row is missing, and
         says nothing about it. That cannot happen today — the bootstrap seeds
         `default` and every project since is a copy of one that has a row —
         so the check is here to keep it that way. A project with no index
         configuration would accept sources and lose the one guard that refuses
         a silent model change. */
      const [configured] = await transaction<{ project_id: string }[]>`
        INSERT INTO index_configuration (project_id, embedding_model, embedding_dimensions)
        SELECT ${project.id}, embedding_model, embedding_dimensions
        FROM index_configuration WHERE project_id = ${from}
        RETURNING project_id
      `;
      if (!configured) {
        throw new Error('This project has no index configuration to copy from.');
      }
      /* Filed in the new project's own log, not the one it was created from.
         The custody line of a corpus should start with its creation. */
      await fileEvent(transaction, {
        projectId: project.id,
        actor: creator,
        type: 'project_created',
        metadata: { name: data.name, slug: data.slug },
      });
    });
    if (!created) throw new Error('That project could not be created.');
    return { id: created, name: data.name, slug: data.slug };
  });

/* What this project is, for the Project tab to state.
 *
 * Read-only, and gated at `read` rather than `admin`: nothing here is a
 * credential. The tab that renders it is admin-only, but the facts themselves
 * are the kind a writer wondering why a search missed ought to be able to see,
 * and gating a query harder than its contents need is how a permission stops
 * meaning anything.
 *
 * `index_configuration` is joined rather than left-joined: a project without
 * one cannot accept a source, so its absence is a fault to surface and not a
 * row to render blank. */
export const getProjectFacts = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const [row] = await client<
      { slug: string; created_at: string; model: string; dimensions: number }[]
    >`
      SELECT projects.slug, projects.created_at,
             configuration.embedding_model AS model,
             configuration.embedding_dimensions AS dimensions
      FROM projects
      JOIN index_configuration AS configuration ON configuration.project_id = projects.id
      WHERE projects.id = ${projectId}
    `;
    if (!row) throw new Error('This project has no index configuration.');
    return {
      slug: row.slug,
      createdAt: row.created_at,
      model: row.model,
      dimensions: Number(row.dimensions),
    };
  });

/* Renaming a project. The name only — never the slug.
 *
 * The slug is what every link anyone has sent contains, and permanence is the
 * property the URL scheme was chosen for; changing it would break history
 * silently and is a decision that deserves more than a text field. The name is
 * a label: it appears on the plate, in the switcher and on an invitation, and
 * it should be correctable without a migration.
 *
 * This exists because the bootstrap project is called `default`, which nobody
 * chose and which every self-hosted instance now reads on its own rail. */
export const renameProject = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ name: string }> => {
    const name = (value as { name?: string } | undefined)?.name?.trim();
    if (!name) throw new Error('A project needs a name.');
    if (name.length > 120) throw new Error('That name is too long.');
    return { project: validateProject(value), name };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);

    /* Same unique column, same courtesy as `createProject` — and excluding
       this project, so re-saving an unchanged name is not an error. */
    const [taken] = await client<{ name: string }[]>`
      SELECT name FROM projects
      WHERE lower(name) = ${data.name.toLowerCase()} AND id <> ${projectId}
    `;
    if (taken) throw new Error(`A project called “${taken.name}” already exists.`);

    await client.begin(async (transaction) => {
      const [before] = await transaction<{ name: string }[]>`
        SELECT name FROM projects WHERE id = ${projectId} FOR UPDATE
      `;
      if (!before) throw new Error('That project no longer exists.');
      if (before.name === data.name) return;
      await transaction`
        UPDATE projects SET name = ${data.name} WHERE id = ${projectId}
      `;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_renamed',
        metadata: { from: before.name, to: data.name },
      });
    });
    return { name: data.name };
  });

/* Archiving removes a project from normal browser and MCP access without
 * deleting its Git bundle, index, identities, keys, or membership. An
 * administrator can restore it from the archived-projects register. */
export const archiveProject = createServerFn({ method: 'POST' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [archived] = await transaction<{ id: string }[]>`
        UPDATE projects SET archived_at = now()
        WHERE id = ${projectId} AND archived_at IS NULL
        RETURNING id
      `;
      if (!archived) throw new Error('That project is no longer available.');
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_archived',
      });
    });
  });

export const restoreProject = createServerFn({ method: 'POST' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireArchivedAdmin(data.project);
    await client.begin(async (transaction) => {
      const [restored] = await transaction<{ id: string }[]>`
        UPDATE projects SET archived_at = NULL
        WHERE id = ${projectId} AND archived_at IS NOT NULL
        RETURNING id
      `;
      if (!restored) throw new Error('That project is no longer archived.');
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_restored',
      });
    });
  });

/* Changing your own name and password goes through `authClient.updateUser` and
   `authClient.changePassword` on the client rather than a server function here.
   Both are better-auth's own routes: they run its hooks, re-issue the session,
   and — for the password — verify the current one and revoke other sessions.
   A raw UPDATE against `"user"` would do none of that. */
