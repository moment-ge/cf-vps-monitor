import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            if (incoming.headers.origin === `http://${incoming.headers.host}`)
              outgoing.setHeader("Origin", "http://127.0.0.1:8787");
          });
        },
      },
    },
  },
  build: { target: "es2022" },
});
