import { loadCloudEnv, loadDotEnv } from './config/env.mjs'
import { createCloudServer } from './app.mjs'

async function main(): Promise<void> {
  loadDotEnv()
  const config = loadCloudEnv()
  const server = await createCloudServer({ config })
  const addr = await server.start()
  console.log(`[vertexia-cloud] Gateway listening on ${addr}`)

  const shutdown = async () => {
    console.log('[vertexia-cloud] Shutting down gracefully...')
    await server.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch(err => {
  console.error('[vertexia-cloud] Startup failed:', err)
  process.exit(1)
})
