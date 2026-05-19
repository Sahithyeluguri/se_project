import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const basePath = process.env.VITE_BASE_PATH || "/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? basePath : "/",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/auth": "http://localhost:8000",
      "/tickets": "http://localhost:8000",
      "/agents": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
}));
