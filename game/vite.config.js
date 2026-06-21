import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// The site deploys public/ as-is (Vercel outputDirectory: "public"), so we build
// straight into public/brawler/. base "/brawler/" makes all asset + fetch URLs
// resolve under that path in both dev and production.
export default defineConfig({
  base: "/brawler/",
  build: {
    outDir: r("../public/brawler"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: r("index.html"),
        select: r("select.html"),
        admin: r("admin.html"),
        editor: r("editor.html"),
        creator: r("creator.html"),
        spells: r("spells.html"),
        lobby: r("lobby.html"),
      },
    },
  },
});
