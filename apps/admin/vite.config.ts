import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Прод-сборка живёт под /admin (api раздаёт статику из ADMIN_STATIC_DIR —
// реаудит RA-I-2); dev по-прежнему на корне :5173.
const base = process.env.ADMIN_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Локальная разработка: API-запросы уходят в chat-api (docs/23_DEVELOPER_GUIDE.md)
      "/api": "http://localhost:3000",
      // Namespace /admin Socket.IO (docs/07 §4.2): прокидываем и websocket
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
