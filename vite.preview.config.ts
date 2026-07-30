/**
 * Config SÓ da bancada visual do explorador Nextcloud (não é build de produção).
 * Troca serviços e contextos por dublês para abrir a tela sem login e sem
 * servidor. Rode com: `npx vite --config vite.preview.config.ts`.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stubs = path.resolve(__dirname, './src/dev/nextcloudPreviewStubs.tsx');

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('preview') },
  resolve: {
    alias: [
      { find: /^.*services\/nextcloud\.service$/, replacement: stubs },
      { find: /^.*services\/nextcloudPresence\.service$/, replacement: stubs },
      { find: /^.*services\/client\.service$/, replacement: stubs },
      { find: /^.*services\/syncfusionCollab\.service$/, replacement: stubs },
      { find: /^.*contexts\/AuthContext$/, replacement: stubs },
      { find: /^.*contexts\/NavigationContext$/, replacement: stubs },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  server: { port: 3099, strictPort: true },
});
