import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('@syncfusion')) return 'vendor-syncfusion';
          if (id.includes('react-pdf') || id.includes('pdfjs-dist')) return 'vendor-react-pdf';
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf-export';
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('openai')) return 'vendor-openai';
          if (id.includes('docx-preview') || id.includes('docxtemplater') || id.includes('docx') || id.includes('pizzip')) return 'vendor-docx';
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react';

          return 'vendor-misc';
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
