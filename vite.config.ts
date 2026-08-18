/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // The App-level integration tests mount the full UI (heavy effects,
    // notifications, auto-backup…); 5s is too tight on slow machines/CI.
    testTimeout: 15000,
  },
})
