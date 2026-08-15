import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Локальная разработка: API-запросы уходят в chat-api (docs/23_DEVELOPER_GUIDE.md)
      "/api": "http://localhost:3000",
    },
  },
});
