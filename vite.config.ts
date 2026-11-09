import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Relative base + HashRouter lets the same build run on GitHub Pages or locally.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
