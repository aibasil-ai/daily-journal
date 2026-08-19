import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.ts?(x)'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['api/**/*.test.ts', 'gas/**/*.test.ts', 'scripts/**/*.test.ts', 'shared/**/*.test.ts'],
        },
      },
    ],
  },
})
