import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    // Auth-gate entry lives in src/server.ts — keep `server.entry` as-is.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    nitro({
      preset: process.env.NITRO_PRESET ?? "node-server",
      output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
    }),
  ],
});
