import { listConceptPaths, readFileAtCommit } from '@commonwealth/corpus';
import { commitConcept } from '@commonwealth/corpus/indexer';
import { parseOkfDocument } from '@commonwealth/pipeline';
import { createServerFn } from '@tanstack/react-start';
import { requireMember, type Scoped, validateProject } from './authorize.js';
import {
  type Authority,
  actorName,
  corpusPath,
  optionalAuthority,
  optionalText,
  pathInput,
  requiredPath,
  tags,
} from './concept-inputs.js';
import { client, indexClient } from './db.js';
import { embeddingModel, embeddings } from './pipeline.js';

function owner(frontmatter: Record<string, unknown>): string | null {
  const generated = frontmatter.generated;
  if (generated === null || typeof generated !== 'object') return null;
  const by = (generated as Record<string, unknown>).by;
  return typeof by === 'string' ? by : null;
}

async function commitAndIndex(
  membership: Awaited<ReturnType<typeof requireMember>>,
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
  subject: string,
  eventType: string
) {
  const result = await commitConcept({
    actor: actorName(membership.userId),
    body,
    corpusPath: corpusPath(),
    embeddingModel: embeddingModel(),
    embeddings: embeddings(),
    frontmatter,
    path,
    sql: indexClient,
    projectId: membership.projectId,
    projectSlug: membership.slug,
    subject,
  });
  await client`
    INSERT INTO events (project_id, actor_admin_id, event_type, metadata)
    VALUES (${membership.projectId}, ${membership.userId}, ${eventType}, ${JSON.stringify({ path, commit: result.commit })}::jsonb)
  `;
  return result;
}

export const createConcept = createServerFn({ method: 'POST' })
  .validator(
    (
      value: unknown
    ): Scoped<{ markdown: string; path: string; tags: string[]; title: string; type: string }> => {
      const input = value as Record<string, unknown>;
      const markdown = optionalText(input.markdown, 'Markdown');
      const title = optionalText(input.title, 'title');
      const type = optionalText(input.type, 'type');
      const path = typeof input.path === 'string' ? requiredPath(input) : null;
      if (!markdown || !title || !type || !path)
        throw new Error('A path, type, title, and Markdown are required.');
      return {
        project: validateProject(value),
        markdown,
        path,
        tags: tags(input.tags),
        title,
        type,
      };
    }
  )
  .handler(async ({ data }) => {
    const membership = await requireMember('write', data.project);
    if ((await listConceptPaths(corpusPath(), membership.slug)).includes(data.path))
      throw new Error('A concept already exists at that path');
    const now = new Date().toISOString();
    return commitAndIndex(
      membership,
      data.path,
      {
        type: data.type,
        title: data.title,
        tags: data.tags,
        generated: { by: actorName(membership.userId), at: now },
        verified: [{ by: actorName(membership.userId), at: now }],
        commonwealth: { authority: 'approved' },
      },
      data.markdown,
      `Create ${data.path}`,
      'concept_created'
    );
  });

export const reviseConcept = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ markdown: string; path: string; title: string }> => {
    const input = value as Record<string, unknown>;
    const markdown = optionalText(input.markdown, 'Markdown');
    const title = optionalText(input.title, 'title');
    const path = typeof input.path === 'string' ? requiredPath(input) : null;
    if (!markdown || !title || !path) throw new Error('A path, title, and Markdown are required.');
    return { project: validateProject(value), markdown, path, title };
  })
  .handler(async ({ data }) => {
    const membership = await requireMember('write', data.project);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    if (
      membership.role === 'writer' &&
      owner(document.frontmatter) !== actorName(membership.userId)
    )
      throw new Error('Writers can only revise concepts they created.');
    const now = new Date().toISOString();
    const verified = Array.isArray(document.frontmatter.verified)
      ? [...document.frontmatter.verified]
      : [];
    verified.push({ by: actorName(membership.userId), at: now });
    return commitAndIndex(
      membership,
      data.path,
      {
        ...document.frontmatter,
        title: data.title,
        generated: { by: actorName(membership.userId), at: now },
        verified,
      },
      data.markdown,
      `Revise ${data.path}`,
      'concept_revised'
    );
  });

export const verifyConcept = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ authority: Authority; path: string }> => {
    const input = value as Record<string, unknown>;
    const authority = optionalAuthority(input.authority);
    const path = typeof input.path === 'string' ? requiredPath(input) : null;
    if (!authority || !path) throw new Error('A path and authority are required.');
    return { project: validateProject(value), authority, path };
  })
  .handler(async ({ data }) => {
    const membership = await requireMember('review', data.project);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    const verified = Array.isArray(document.frontmatter.verified)
      ? [...document.frontmatter.verified]
      : [];
    verified.push({ by: actorName(membership.userId), at: new Date().toISOString() });
    return commitAndIndex(
      membership,
      data.path,
      {
        ...document.frontmatter,
        verified,
        commonwealth: {
          ...(typeof document.frontmatter.commonwealth === 'object' &&
          document.frontmatter.commonwealth !== null
            ? document.frontmatter.commonwealth
            : {}),
          authority: data.authority,
        },
      },
      document.body,
      `Verify ${data.path}`,
      'concept_verified'
    );
  });

export const deprecateConcept = createServerFn({ method: 'POST' })
  .validator(pathInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('review', data.project);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    return commitAndIndex(
      membership,
      data.path,
      { ...document.frontmatter, status: 'deprecated' },
      document.body,
      `Deprecate ${data.path}`,
      'concept_deprecated'
    );
  });
