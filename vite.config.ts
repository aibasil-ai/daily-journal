import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    plugins: [react()],
    define: {
      __BUILD_JOURNAL_CONFIG__: JSON.stringify({
        googleClientId: env.APP_GOOGLE_CLIENT_ID ?? '',
        gasScriptId: env.APP_GAS_SCRIPT_ID ?? '',
      }),
    },
  }
})
