import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const isDevelopment = process.env.NODE_ENV === 'development'

export default defineConfig({
  resolve: {
    alias: [
      { find: '~', replacement: path.resolve(__dirname, 'src') },
      { find: /^~\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
    ],
  },
  plugins: [tailwindcss(), react(), viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? 'inline' : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: {
      input: 'mcp-app.html',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
})
