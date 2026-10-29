import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: process.env.ALLOWED_HOSTS
      ? process.env.ALLOWED_HOSTS.split(",")
      : true,
    ...(process.env.HMR_CLIENT_PORT
      ? { hmr: { clientPort: parseInt(process.env.HMR_CLIENT_PORT, 10) } }
      : {}),
  },
});
