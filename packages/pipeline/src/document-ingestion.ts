import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
]);

export type DocumentIngestionOptions = {
  markitdownUrl: string;
  /* Both callers must point at the same directory, or one will convert a
     document the other cannot find on disk. In compose this is the shared
     `source_data` volume. */
  storagePath: string;
  maxUploadBytes: number;
};

export type ConvertedDocument = {
  markdown: string;
  contentHash: string;
  storagePath: string;
};

export class DocumentIngestion {
  constructor(private readonly options: DocumentIngestionOptions) {}

  async ingest(input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<ConvertedDocument> {
    if (input.bytes.byteLength > this.options.maxUploadBytes) {
      throw new Error(`Document exceeds the ${this.options.maxUploadBytes} byte upload limit`);
    }
    if (!allowedMimeTypes.has(input.mimeType)) throw new Error('Unsupported document MIME type');

    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(input.bytes)], { type: input.mimeType }),
      input.filename
    );
    /* Named for the same reason as the embedding call: two slow network hops in
       one request, and an anonymous timeout leaves you guessing which. */
    const response = await fetch(`${this.options.markitdownUrl}/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw new Error(`Converting ${input.filename} timed out after 30s.`);
      }
      throw new Error(`Could not reach the document converter at ${this.options.markitdownUrl}`, {
        cause,
      });
    });
    if (!response.ok) throw new Error('Document conversion failed');
    const payload = (await response.json()) as { markdown?: string };
    if (!payload.markdown?.trim()) throw new Error('Document conversion produced no text');

    const contentHash = digest(input.bytes);
    const storagePath = join(this.options.storagePath, contentHash);
    await mkdir(this.options.storagePath, { recursive: true });
    try {
      await writeFile(storagePath, input.bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (digest(await readFile(storagePath)) !== contentHash) {
        throw new Error('Stored document content does not match its expected hash');
      }
    }

    return { markdown: payload.markdown, contentHash, storagePath };
  }
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
