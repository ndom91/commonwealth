import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";

const allowedMimeTypes = new Set([
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/html", "text/markdown", "text/plain",
]);

export type ConvertedDocument = {
  markdown: string;
  contentHash: string;
  storagePath: string;
};

export class DocumentIngestion {
  constructor(private readonly config: Config) {}

  async ingest(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ConvertedDocument> {
    if (input.bytes.byteLength > this.config.MAX_UPLOAD_BYTES) {
      throw new Error(`Document exceeds the ${this.config.MAX_UPLOAD_BYTES} byte upload limit`);
    }
    if (!allowedMimeTypes.has(input.mimeType)) throw new Error("Unsupported document MIME type");

    const form = new FormData();
    form.append("file", new Blob([Buffer.from(input.bytes)], { type: input.mimeType }), input.filename);
    const response = await fetch(`${this.config.MARKITDOWN_URL}/convert`, {
      method: "POST", body: form, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Document conversion failed");
    const payload = (await response.json()) as { markdown?: string };
    if (!payload.markdown?.trim()) throw new Error("Document conversion produced no text");

    const contentHash = digest(input.bytes);
    const storagePath = join(this.config.SOURCE_STORAGE_PATH, contentHash);
    await mkdir(this.config.SOURCE_STORAGE_PATH, { recursive: true });
    try {
      await writeFile(storagePath, input.bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (digest(await readFile(storagePath)) !== contentHash) {
        throw new Error("Stored document content does not match its expected hash");
      }
    }

    return { markdown: payload.markdown, contentHash, storagePath };
  }
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
