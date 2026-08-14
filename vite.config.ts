import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    define: {
      __BUILD_JOURNAL_CONFIG__: JSON.stringify({
        googleClientId: env.APP_GOOGLE_CLIENT_ID ?? '',
        gasDeploymentId: env.APP_GAS_DEPLOYMENT_ID ?? '',
      }),
    },
  }
})
