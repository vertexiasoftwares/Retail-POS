import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { MongoCloudStore } from './db/mongo-store.mjs'
import { authenticateCloudSession } from './routes/auth.mjs'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface CloudRealtimeEvent {
  type: string
  shopUuid: string
  payload?: Record<string, unknown>
  timestamp?: string
}

interface CloudClient {
  socket: Socket
  token: string
  userId: string
  shopUuid: string
  lastSeenAt: number
}

export class CloudRealtimeBroker {
  private readonly clients = new Set<CloudClient>()
  private readonly timer: NodeJS.Timeout

  constructor(private readonly store: MongoCloudStore) {
    this.timer = setInterval(() => {
      const now = Date.now()
      for (const client of this.clients) {
        if (now - client.lastSeenAt > 75_000) {
          this.clients.delete(client)
          try {
            client.socket.destroy()
          } catch {}
          continue
        }
        try {
          client.socket.write(Buffer.from([0x89, 0x00]))
        } catch {
          this.clients.delete(client)
        }
      }
    }, 25_000)
    this.timer.unref?.()
  }

  async handleUpgrade(req: IncomingMessage, socket: Socket): Promise<void> {
    const rawUrl = req.url || ''
    if (!rawUrl.startsWith('/api/cloud/events')) {
      socket.destroy()
      return
    }

    const parsedUrl = new URL(rawUrl, 'http://localhost')
    let token = parsedUrl.searchParams.get('token')
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim()
    }
    if (!token && req.headers.cookie) {
      for (const part of req.headers.cookie.split(';')) {
        const idx = part.indexOf('=')
        if (idx >= 0 && part.slice(0, idx).trim() === 'vertexia_cloud_session') {
          token = decodeURIComponent(part.slice(idx + 1).trim())
          break
        }
      }
    }

    const authResult = await authenticateCloudSession(token, this.store)
    if ('error' in authResult) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const key = req.headers['sec-websocket-key']
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const acceptKey = createHash('sha1').update(key + GUID).digest('base64')
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n'),
    )

    const client: CloudClient = {
      socket,
      token: token!,
      userId: authResult.session.userId,
      shopUuid: authResult.session.shopUuid,
      lastSeenAt: Date.now(),
    }
    this.clients.add(client)

    this.sendToClient(client, {
      type: 'cloud:connected',
      shopUuid: client.shopUuid,
      payload: { userId: client.userId, shopUuid: client.shopUuid },
      timestamp: new Date().toISOString(),
    })

    socket.on('data', buffer => {
      client.lastSeenAt = Date.now()
      if (buffer.length < 2) return
      const opcode = buffer[0] & 0x0f
      if (opcode === 0x09) {
        try {
          socket.write(Buffer.from([0x8a, 0x00]))
        } catch {}
      } else if (opcode === 0x08) {
        try {
          socket.write(Buffer.from([0x88, 0x00]))
        } catch {}
        this.clients.delete(client)
        socket.destroy()
      }
    })
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => {
      this.clients.delete(client)
      socket.destroy()
    })
  }

  private encodeFrame(event: CloudRealtimeEvent): Buffer {
    const payloadBuf = Buffer.from(
      JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() }),
      'utf8',
    )
    if (payloadBuf.length < 126) {
      return Buffer.concat([Buffer.from([0x81, payloadBuf.length]), payloadBuf])
    }
    if (payloadBuf.length < 65536) {
      return Buffer.concat([
        Buffer.from([0x81, 126, (payloadBuf.length >> 8) & 0xff, payloadBuf.length & 0xff]),
        payloadBuf,
      ])
    }
    const lenBuf = Buffer.alloc(8)
    lenBuf.writeBigUInt64BE(BigInt(payloadBuf.length), 0)
    return Buffer.concat([Buffer.from([0x81, 127]), lenBuf, payloadBuf])
  }

  private sendToClient(client: CloudClient, event: CloudRealtimeEvent): void {
    try {
      client.socket.write(this.encodeFrame(event))
    } catch {
      this.clients.delete(client)
    }
  }

  broadcastToShop(shopUuid: string, event: CloudRealtimeEvent): void {
    const normalized = shopUuid.toLowerCase()
    const frame = this.encodeFrame(event)
    for (const client of this.clients) {
      if (client.shopUuid !== normalized) continue
      try {
        client.socket.write(frame)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  closeAll(): void {
    clearInterval(this.timer)
    for (const client of this.clients) {
      try {
        client.socket.write(Buffer.from([0x88, 0x00]))
        client.socket.destroy()
      } catch {}
    }
    this.clients.clear()
  }
}
