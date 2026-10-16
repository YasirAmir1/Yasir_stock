import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'lucide-react',
      'xlsx',
      'html2canvas',
      'html2canvas-pro',
      'jspdf',
      'jspdf-autotable',
      'clsx',
      'tailwind-merge',
      'motion',
      'firebase/app',
      'firebase/firestore'
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
