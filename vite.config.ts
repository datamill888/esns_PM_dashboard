import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Nitro builds the server bundle and is only needed for `vite build`. Import it
// lazily inside the build branch so `vite dev` never loads it. node-server is
// what actually runs this app (`bun run serve`, `./run.sh prod`, and the
// platform's preview build all execute dist/server/index.mjs), so it is the
// default — a local build then produces the same artifact that ships. Deploy
// elsewhere with NITRO_PRESET (e.g. `vercel`, `netlify`, `cloudflare-module`).
const NITRO_PRESET = process.env.NITRO_PRESET ?? "node-server";

export default defineConfig(async ({ command }) => {
  const plugins = [
    tailwindcss(),
    tanstackStart({
      // Use src/server.ts as the SSR entry (it wraps requests in an error boundary).
      server: { entry: "server" },
      // Fail the build if client code imports server-only modules.
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        preset: NITRO_PRESET,
        output: {
          dir: "dist",
          serverDir: "dist/server",
          publicDir: "dist/client",
        },
      }),
    );
  }

  plugins.push(viteReact());

  return {
    plugins,
    resolve: {
      // `@/*` is the only tsconfig path mapping, so this alias replaces
      // vite-tsconfig-paths (Vite 8 warns that the plugin is redundant).
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      // Keep a single copy of React and TanStack Query across SSR + client,
      // and of the libraries @incorta/ui shares context with (portals,
      // charts, forms).
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
        "@base-ui/react",
        "recharts",
        "react-hook-form",
      ],
    },
    // Pre-bundle the whole design system when the dev server starts. Vite
    // otherwise bundles only the imports it has seen, so each component the
    // app starts using later re-bundles and force-reloads the page.
    optimizeDeps: {
      include: [
        "@incorta/ui/components/*",
        "@incorta/ui/hooks/*",
        "@incorta/ui/lib/*",
        "lucide-react",
        "recharts",
        "react-hook-form",
        "@hookform/resolvers/zod",
        "zod",
        "date-fns",
        "class-variance-authority",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "seroval",
      ],
    },
    server: { host: "::", port: 8080 },
  };
});
