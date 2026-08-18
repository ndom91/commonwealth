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

/* Same treatment as `positiveInt`: the fallback goes through the same pipe as a
   supplied value. Only the literal string `false` disables — anything else
   present and non-empty is a yes, so a typo fails closed towards *trusting*
   rather than silently ignoring a proxy that is really there. */
const boolean = (fallback: boolean) =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => value !== 'false')
    ),
    String(fallback)
  );

const environment = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
  OLLAMA_URL: v.pipe(v.string(), v.url()),
  EMBEDDING_MODEL: v.pipe(v.string(), v.minLength(1)),
  /* The task description for an asymmetric embedding model's query side. Unset
     means queries are embedded exactly like documents, which is right for a
     symmetric model and wrong for the shipped default — see `EmbeddingOptions`.
     Deliberately has no built-in default: it is only correct for the model it
     was written for, and compose pins both together. */
  EMBEDDING_QUERY_INSTRUCTION: v.optional(v.string()),
  PORT: positiveInt(3000),
  CORPUS_PATH: v.optional(v.pipe(v.string(), v.minLength(1)), '/app/corpora'),
  MAX_REQUEST_BYTES: positiveInt(15 * 1024 * 1024),
  /* Containers bind to loopback by default, so no proxy is trusted unless the
     operator explicitly says one is forwarding client addresses. */
  TRUST_FORWARDED_FOR: boolean(false),
  /* Per credential. An agent working hard does a handful of calls a second in
     bursts; this is well clear of that and still bounds the scrypt cost of a
     flood carrying a real key prefix. See the note in `index.ts`. */
  RATE_LIMIT_KEY_WINDOW: positiveInt(60),
  RATE_LIMIT_KEY_MAX: positiveInt(120),
  /* Per address, as a backstop for volume that never reaches a real prefix.
     Generous, because a whole team can share one egress address. */
  RATE_LIMIT_ADDRESS_WINDOW: positiveInt(60),
  RATE_LIMIT_ADDRESS_MAX: positiveInt(600),
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
