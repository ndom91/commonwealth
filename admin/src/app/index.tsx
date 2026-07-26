import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSession } from '../lib/session.js';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    throw redirect({ to: (await getSession()) ? '/identities' : '/sign-in' });
  },
  component: () => null,
});
