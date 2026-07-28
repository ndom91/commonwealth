/* Splitting a document into the units that get embedded and quoted back.
 *
 * The unit of division is a *block* — a paragraph, a list, a table, a fenced
 * code sample — never a word. An earlier version split on `/\s+/` and rejoined
 * with a single space, which meant every newline in the corpus was destroyed:
 * a YAML sample came back as ```yaml services: admin: ports: - "3001:3001"```
 * on one line, and a table became a run of pipes. That is not only a worse
 * embedding, it is wrong output — `chunks.content` is what `excerpt` hands to
 * an agent, so a code sample it quotes has to survive intact.
 *
 * Fences are tracked rather than pattern-matched around, which fixes a second
 * problem with splitting on `^#{1,6}\s+`: a shell sample containing a `# set
 * the port` comment used to start a new section, tearing the script in half
 * and attributing the remainder to a heading that was really a comment.
 *
 * Headings accumulate into a path. `Deploy > Ports` says more about a chunk
 * than `Ports` does, and the leaf alone loses the parent entirely once a `###`
 * appears. A heading with no body of its own does not become a chunk — it stays
 * on the stack and prefixes its descendants, so an outline heading no longer
 * produces a chunk whose whole content is the word it contains. */

const MAX_CHUNK_WORDS = 500;
const OVERLAP_WORDS = 50;

/* Up to three spaces of indentation still opens a fence in CommonMark; four
   makes it an indented code block, which is a block either way. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export type Chunk = {
  content: string;
  /* The nearest heading. Kept alongside `headingPath` because it is what the
     `chunks.heading` column stores and what search results display. */
  heading: string | null;
  headingPath: string[];
  tokenCount: number;
};

type Section = { path: string[]; blocks: string[] };

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/* One pass, tracking two things the old regex split could not see: whether we
   are inside a fence, and how deep the heading stack is. */
function parseSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  let blocks: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const endBlock = () => {
    const block = buffer.join('\n').trim();
    if (block) blocks.push(block);
    buffer = [];
  };
  /* Pushes whatever has accumulated under the *current* heading path, which is
     why it runs before the stack is adjusted for a new heading. A section with
     no blocks is dropped rather than emitted. */
  const endSection = () => {
    endBlock();
    if (blocks.length > 0) sections.push({ path: stack.map((entry) => entry.text), blocks });
    blocks = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE);

    if (fence) {
      buffer.push(line);
      /* A fence closes on the same character, repeated at least as many times.
         Anything else inside it — including a `#` comment — is content. */
      if (
        fenceMatch?.[1] &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
        endBlock();
      }
      continue;
    }

    if (fenceMatch?.[1]) {
      endBlock();
      fence = fenceMatch[1];
      buffer.push(line);
      continue;
    }

    const headingMatch = line.match(HEADING);
    if (headingMatch?.[1] && headingMatch[2]) {
      endSection();
      const level = headingMatch[1].length;
      while ((stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push({ level, text: headingMatch[2] });
      continue;
    }

    if (line.trim() === '') {
      endBlock();
      continue;
    }

    buffer.push(line);
  }

  /* An unterminated fence is still content: whatever is in the buffer belongs
     to the last section rather than being dropped on the floor. */
  endSection();
  return sections;
}

function pack(section: Section): Chunk[] {
  const chunks: Chunk[] = [];
  const heading = section.path.at(-1) ?? null;
  let current: string[] = [];
  let words = 0;

  const emit = () => {
    if (current.length === 0) return;
    const content = current.join('\n\n');
    chunks.push({ content, heading, headingPath: section.path, tokenCount: countWords(content) });
  };

  for (const block of section.blocks) {
    const blockWords = countWords(block);

    if (words > 0 && words + blockWords > MAX_CHUNK_WORDS) {
      emit();
      /* Overlap by whole trailing blocks rather than a word count, so the
         carried context is always readable. A block bigger than the overlap
         budget stops the carry instead of being truncated into it. */
      const carried: string[] = [];
      let carriedWords = 0;
      for (let index = current.length - 1; index >= 0; index--) {
        const candidate = current[index];
        if (!candidate) continue;
        const candidateWords = countWords(candidate);
        if (carriedWords + candidateWords > OVERLAP_WORDS) break;
        carried.unshift(candidate);
        carriedWords += candidateWords;
      }
      current = carried;
      words = carriedWords;
    }

    /* A single block over the limit is emitted whole on the next boundary. A
       code sample cut in half is worse than a chunk over budget. */
    current.push(block);
    words += blockWords;
  }

  emit();
  return chunks;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  return parseSections(markdown).flatMap(pack);
}
