import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tanstackStart({ srcDirectory: "src", router: { routesDirectory: "app" } }),
    nitro(),
    viteReact(),
  ],
  server: { port: Number(process.env.ADMIN_PORT ?? 3001), strictPort: true },
});
