import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third arg '' loads every var, not just VITE_-prefixed ones. Vars without the
  // VITE_ prefix stay server-side and are never injected into the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.DEV_PROXY_TARGET || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Used by the `local` profile, where VITE_BACKEND_BASE is empty so requests
        // stay relative and cookies stay same-site. In `remote` mode the base URL is
        // absolute, so these rules never match.
        '/auth': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
