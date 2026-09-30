import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served by Express under /builder in production; in development the API is proxied to the Express server.
export default defineConfig({
  base: "/builder/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared/flow-rules", import.meta.url)) },
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${process.env.API_PORT || 3000}` },
  },
});
