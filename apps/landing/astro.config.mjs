import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    server: {
      // Development only. These allow temporary ngrok and Cloudflare tunnel subdomains.
      allowedHosts: ['.ngrok-free.dev', '.trycloudflare.com'],
    },
  },
});
