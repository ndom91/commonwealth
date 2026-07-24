import { z } from "zod";

const environment = z.object({
  DATABASE_URL: z.string().url(),
  OLLAMA_URL: z.string().url(),
  EMBEDDING_MODEL: z.string().min(1),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1),
  BOOTSTRAP_ADMIN_KEY: z.string().min(24),
  PORT: z.coerce.number().int().positive().default(3000),
  MARKITDOWN_URL: z.string().url().default("http://markitdown:8000"),
  SOURCE_STORAGE_PATH: z.string().default("/app/storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_REQUEST_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
});

export type Config = z.infer<typeof environment>;

export function loadConfig(): Config {
  return environment.parse(process.env);
}
