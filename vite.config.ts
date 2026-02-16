import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    headers: {
      // Required for SharedArrayBuffer (not currently used, but future-proofing)
      // Uncomment if you switch to SharedArrayBuffer for parameter passing:
      // 'Cross-Origin-Opener-Policy': 'same-origin',
      // 'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  // Ensure .wasm files are served with correct MIME type
  assetsInclude: ['**/*.wasm'],
});
