import { history, readFileAtCommit } from '@commonwealth/corpus';
import { okfMetadata, parseOkfDocument } from '@commonwealth/pipeline';

export async function conceptVersion(input: {
  commit: string;
  corpusPath: string;
  path: string;
  project: string;
}) {
  const entries = await history(input.corpusPath, input.project, input.path);
  if (!entries.some((entry) => entry.commit === input.commit)) {
    throw new Error('That commit is not in this concept history');
  }

  const markdown = await readFileAtCommit(
    input.corpusPath,
    input.project,
    input.path,
    input.commit
  );
  const document = parseOkfDocument(markdown);
  const metadata = okfMetadata(document.frontmatter);
  return {
    authority: metadata.authority,
    commit: input.commit,
    last_verified_at: metadata.lastVerifiedAt,
    markdown,
    tags: metadata.tags,
    title: metadata.title,
    type: metadata.type,
  };
}
