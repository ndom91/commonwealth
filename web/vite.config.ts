import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackStart({ srcDirectory: 'src', router: { routesDirectory: 'app' } }),
    nitro(),
    viteReact(),
  ],
  server: { port: Number(process.env.WEB_PORT ?? 3001), strictPort: true },
});
