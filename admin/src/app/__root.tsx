import * as Tooltip from '@radix-ui/react-tooltip';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import appCss from './styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#0e1214' },
      { title: 'Custody bench — Commonwealth' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: () => (
    <html lang="en">
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
  ),
  notFoundComponent: () => <main>Page not found</main>,
});
