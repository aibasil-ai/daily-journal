import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts?(x)', 'gas/**/*.test.ts', 'scripts/**/*.test.ts', 'api/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
