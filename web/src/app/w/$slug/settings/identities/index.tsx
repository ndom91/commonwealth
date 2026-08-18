import { createFileRoute } from '@tanstack/react-router';

/* The parent route owns the `.detail` section so the one-time credential tag
   can render above whichever bench is showing, so this contributes only its
   sentence. */
export const Route = createFileRoute('/w/$slug/settings/identities/')({
  component: () => (
    <p className="empty prose">
      Select a holder from the register to see their credentials and custody line, or issue a new
      identity.
    </p>
  ),
});
