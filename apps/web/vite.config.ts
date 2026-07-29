import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: path.resolve(root, '../../dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('beautiful-mermaid')) return 'rich-mermaid';
          if (id.includes('@pierre/diffs')) return 'rich-diff';
          if (id.includes('@uiw/react-json-view')) return 'rich-json';
          if (id.includes('react-pdf') || id.includes('pdfjs-dist')) return 'rich-pdf';
          if (id.includes('@shikijs') || id.includes('oniguruma-to-es')) return undefined;
          if (id.includes('katex')) return 'rich-math';
          if (id.includes('write-excel-file') || id.includes('fflate')) return 'rich-export';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast')) return 'markdown';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.FRAKIO_WORK_API_URL || 'http://127.0.0.1:8787',
    },
  },
});
