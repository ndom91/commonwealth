/* Every read in the workbench fails the same two ways: the signed-in account
   is not an administrator on this instance, or the admin service cannot reach
   Postgres. Mapping both here keeps the wording identical across the register,
   the review queue and the holder bench. */
export function readFailure(cause: unknown, subject: string): string {
  const raw = cause instanceof Error ? cause.message : '';
  return /forbidden/i.test(raw)
    ? 'This account does not have administrator access on this instance. Ask an administrator to grant it, then reload.'
    : `${subject} could not be read. Check that the admin service can reach the database, then retry.`;
}
