import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Apps instaláveis SEPARADOS (PWAs com identidade própria: id, escopo, nome e
 * ícone), além do CRM. Cada nome aqui é o de um `<slug>.html` na raiz.
 *
 * É a ÚNICA lista do build — não use glob de `*.html`: a raiz também tem as
 * bancadas de desenvolvimento (docx-pdf-lab, dev-ribbon-*, nextcloud-preview),
 * que não podem ir para produção.
 *
 * Receita completa para criar o próximo: docs/PWA_APPS.md
 */
const PWA_APPS = ['atendimento', 'editor'] as const;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || 'dev'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Uma página por app instalável: o CRM (index.html) e cada um dos
      // PWA_APPS, com o seu próprio manifest já no HTML servido — é isso que
      // faz o navegador instalar apps DIFERENTES, e não o CRM de novo.
      input: {
        index: path.resolve(__dirname, 'index.html'),
        ...Object.fromEntries(
          PWA_APPS.map((app) => [app, path.resolve(__dirname, `${app}.html`)]),
        ),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('@syncfusion')) return 'vendor-syncfusion';
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('openai')) return 'vendor-openai';
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react';
          
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  publicDir: 'public',
});
