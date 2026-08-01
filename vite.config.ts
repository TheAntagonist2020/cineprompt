import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { rm, stat } from "node:fs/promises";
import { generateShards } from "./script/data-shards";

const DATA_SRC = path.resolve(import.meta.dirname, "client", "public", "data.json");
const DATA_OUT = path.resolve(import.meta.dirname, "client", "public", "data");

/**
 * The Python pipeline writes one ~6.5 MB `client/public/data.json`. Serving it
 * as-is meant every visit downloaded and parsed the whole library before first
 * paint. This plugin derives the sharded payload the client actually fetches
 * (`client/public/data/*`) from that file, in both dev and build, so the
 * pipeline and the CI job that runs it stay completely untouched.
 *
 * The generated directory is git-ignored: it is a build artifact, always
 * reproducible from data.json.
 */
function dataShards(): Plugin {
  let generated = false;
  const build = async (label: string) => {
    const { core, shards, sourceBytes } = await generateShards(DATA_SRC, DATA_OUT);
    const shardBytes = shards.reduce((n, s) => n + s.bytes, 0);
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    console.log(
      `[data-shards] ${label}: ${kb(sourceBytes)} -> core ${kb(core.bytes)} ` +
        `(${((100 * core.bytes) / sourceBytes).toFixed(1)}%) + ${shards.length} lazy shards ${kb(shardBytes)}`,
    );
    generated = true;
  };

  return {
    name: "cineprompt-data-shards",

    async buildStart() {
      await build("build");
    },

    // Dev: regenerate when the pipeline rewrites data.json mid-session, so
    // `npm run data:sync` shows up on refresh without restarting Vite.
    configureServer(server) {
      server.watcher.add(DATA_SRC);
      server.watcher.on("change", async (file) => {
        if (path.resolve(file) !== DATA_SRC) return;
        await build("data.json changed");
        server.ws.send({ type: "full-reload" });
      });
    },

    // Vite copies all of publicDir into the bundle, which would ship the
    // 6.5 MB monolith alongside the shards derived from it. Nothing fetches
    // it at runtime any more, so drop it from the deployed output.
    async closeBundle() {
      if (!generated) return;
      const stray = path.resolve(import.meta.dirname, "dist/public/data.json");
      const size = await stat(stray).then((s) => s.size, () => 0);
      if (size) {
        await rm(stray, { force: true });
        console.log(`[data-shards] pruned dist/public/data.json (${(size / 1024).toFixed(0)} KB)`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dataShards()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable vendor chunks: app-code edits don't invalidate the big
        // framework chunks in the browser/CDN cache, and the chart stack
        // only downloads on pages that draw charts.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/framer-motion/")) return "motion";
          if (
            /node_modules\/(recharts|victory-vendor|d3-|react-smooth|recharts-scale)/.test(id)
          ) {
            return "charts";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
