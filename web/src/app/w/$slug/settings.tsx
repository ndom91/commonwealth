import { createFileRoute, Outlet } from '@tanstack/react-router';
import { requireRole } from '../../../lib/route-guards.js';

/* Administering the workspace: what it is called, who can sign in to it, and
 * which agents hold credentials against it.
 *
 * One gate for the whole section rather than one per tab. Every child is
 * administrative in the same way, so repeating the check three times would only
 * be three places to forget it. Enforced again in every server function the
 * tabs call — see `lib/authorize.ts`.
 *
 * This layout draws nothing. Each tab renders its own `AppShell` so it can keep
 * its own title and its own masthead action — Identities issues credentials
 * from up there — and passes `tabs` so the bar is identical across all three.
 *
 * Not to be confused with `/w/:slug/account`, which is your own name and
 * password. That one is a preference and reachable at every role; this one
 * grants and revokes access. */
export const Route = createFileRoute('/w/$slug/settings')({
  beforeLoad: requireRole('admin'),
  component: () => <Outlet />,
});
