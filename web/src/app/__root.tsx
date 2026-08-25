import * as Tooltip from '@radix-ui/react-tooltip';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { readTheme } from '../lib/session.js';
import type { Theme } from '../lib/theme.js';
import appCss from './styles.css?url';

/* The ground of each scheme. The browser paints its own chrome — the address bar
   on mobile, the window surround on some desktops — with this, so a stale value
   frames a light page in near-black. */
const GROUND: Record<Theme, string> = {
  dark: '#0a0a0a',
  light: '#ffffff',
};

/* `theme-color` for a reader who has pinned a scheme, and for one who has not.
 *
 * Pinned, there is exactly one right answer and the media queries would get it
 * wrong — a reader on a light OS who pinned dark would be framed in white. Unpinned,
 * the two media variants are right, and let the browser follow the OS with us. */
function themeColor(theme: Theme | undefined) {
  if (theme) {
    return [{ name: 'theme-color', content: GROUND[theme] }];
  }

  return [
    { name: 'theme-color', content: GROUND.light, media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: GROUND.dark, media: '(prefers-color-scheme: dark)' },
  ];
}

function RootDocument() {
  const theme = Route.useLoaderData();
  return (
    /* `data-theme` is absent unless the reader pinned a scheme, and absent is
       what makes the stylesheet defer to the operating system. Set here during
       SSR rather than by a script after paint, so a pinned scheme is already
       correct in the first frame and there is nothing to flash. */
    <html lang="en" data-theme={theme}>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* One provider for the whole app so the open delay is shared: moving
            along a register of timestamps should not re-serve the delay on
            every row. `skipDelayDuration` keeps that grace period short, since
            these tooltips are read by scanning rather than by settling. */}
        <Tooltip.Provider delayDuration={250} skipDelayDuration={400}>
          <Outlet />
        </Tooltip.Provider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => readTheme(),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...themeColor(loaderData),
      /* The fallback, and deliberately bare. Every signed-in page overrides it
         with the project it is in — see the `head` on `w/$slug.tsx` — so what
         is left here is what the routes outside a project show: sign-in, an
         invitation, the project picker.
       *
         Those must not name a project. Nothing about the instance is knowable
         before authentication and none of it is anybody's business until then,
         which is the same rule the sign-in copy already follows.
       *
         It read "Custody bench — Commonwealth" until now. That is the design
         system's north star, and it stays that — but it was the same eleven
         characters on every page of every project, which is the one thing a
         tab title cannot afford to be. */
      { title: 'Commonwealth' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootDocument,
  notFoundComponent: () => <main>Page not found</main>,
});
