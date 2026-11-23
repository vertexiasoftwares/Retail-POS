import { createServer, getDefaultDatabasePath } from './server.mjs'

async function main() {
  const port = Number(process.env.PORT) || 8080
  const host = process.env.HOST || '0.0.0.0'
  const databasePath = getDefaultDatabasePath()

  console.log(`[Vertexia Server] Initializing on ${host}:${port}...`)
  console.log(`[Vertexia Server] Database path: ${databasePath}`)

  let server: Awaited<ReturnType<typeof createServer>> | null = null

  try {
    server = await createServer({ port, host, databasePath })
    const url = await server.start()
    console.log(`[Vertexia Server] Server is online at ${url}`)
    console.log(`[Vertexia Server] Local browser URL: http://localhost:${port}/`)
    console.log(`[Vertexia Server] Health check: http://localhost:${port}/api/health`)
  } catch (error: unknown) {
    const err = error as Error
    console.error(`[Vertexia Server] Startup failed:`, err.message)
    process.exit(1)
  }

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[Vertexia Server] Received ${signal}. Shutting down gracefully...`)
    try {
      await server?.stop()
      console.log(`[Vertexia Server] Shutdown complete.`)
      process.exit(0)
    } catch (err: unknown) {
      const error = err as Error
      console.error(`[Vertexia Server] Error during shutdown:`, error.message)
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
