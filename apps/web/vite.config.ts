import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_APP_MODE === "clipmine" ? "http://localhost:8000" : "http://localhost:8787",
    },
  },
  test: {
    environment: "node",
  },
});
