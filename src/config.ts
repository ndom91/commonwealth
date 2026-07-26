import * as v from 'valibot';

/* Env vars arrive as strings, so anything numeric is parsed rather than
   coerced — valibot has no `z.coerce` equivalent and asks for the conversion to
   be spelled out. The fallback is therefore also a string: it goes through the
   same pipe as a supplied value, so a typo'd default fails here rather than
   reaching the server as a silently different number.

   Plain `object`, never `strictObject`: this validates `process.env`, which
   carries the entire environment. Unknown keys must be ignored, not rejected. */
const positiveInt = (fallback: number) =>
  v.optional(
    v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
    String(fallback)
  );

const environment = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
  OLLAMA_URL: v.pipe(v.string(), v.url()),
  EMBEDDING_MODEL: v.pipe(v.string(), v.minLength(1)),
  PORT: positiveInt(3000),
  MARKITDOWN_URL: v.optional(v.pipe(v.string(), v.url()), 'http://markitdown:8000'),
  SOURCE_STORAGE_PATH: v.optional(v.string(), '/app/storage'),
  MAX_UPLOAD_BYTES: positiveInt(10 * 1024 * 1024),
  MAX_REQUEST_BYTES: positiveInt(15 * 1024 * 1024),
});

export type Config = v.InferOutput<typeof environment>;

export function loadConfig(): Config {
  const result = v.safeParse(environment, process.env);
  if (result.success) return result.output;

  /* Startup is the worst place to dump a validation object. Someone who forgot
     one variable should be told which one, in a sentence. */
  const problems = result.issues
    .map((issue) => {
      const name = issue.path?.map((segment) => String(segment.key)).join('.') ?? 'environment';
      return `${name} (${issue.message})`;
    })
    .join(', ');
  throw new Error(
    `Invalid environment configuration: ${problems}. Set these on the service and restart.`
  );
}
