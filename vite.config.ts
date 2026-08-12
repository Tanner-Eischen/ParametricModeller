import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
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
