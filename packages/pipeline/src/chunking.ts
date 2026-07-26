const MAX_CHUNK_WORDS = 500;
const OVERLAP_WORDS = 50;

export type Chunk = {
  content: string;
  heading: string | null;
  tokenCount: number;
};

export function chunkMarkdown(markdown: string): Chunk[] {
  const sections = markdown
    .replace(/\r\n/g, '\n')
    .split(/(?=^#{1,6}\s+)/m)
    .map((section) => section.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  for (const section of sections.length > 0 ? sections : [markdown.trim()]) {
    const heading = section.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? null;
    const words = section.split(/\s+/).filter(Boolean);

    for (let start = 0; start < words.length; start += MAX_CHUNK_WORDS - OVERLAP_WORDS) {
      const window = words.slice(start, start + MAX_CHUNK_WORDS);
      if (window.length === 0) break;
      chunks.push({
        content: window.join(' '),
        heading,
        tokenCount: window.length,
      });
      if (start + MAX_CHUNK_WORDS >= words.length) break;
    }
  }

  return chunks;
}
