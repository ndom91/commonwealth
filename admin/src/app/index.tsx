import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSession } from '../lib/session.js';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    throw redirect((await getSession()) ? { to: '/sources', search: {} } : { to: '/sign-in' });
  },
  component: () => null,
});
