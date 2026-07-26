import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sources/')({
  component: () => (
    <section className="detail" aria-label="Selected source">
      <p className="empty prose">
        Select a source from the register to read it, inspect its revisions, and set its authority.
      </p>
    </section>
  ),
});
