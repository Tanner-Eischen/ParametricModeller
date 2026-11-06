import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
    // Do not ship the application's source in production release artifacts.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples/')) {
            return 'three-addons';
          }
          if (id.includes('node_modules/three/')) {
            return 'three';
          }
          return undefined;
        },
      },
    },
  },
});
