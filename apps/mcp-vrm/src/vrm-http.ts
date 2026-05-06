import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ServerConfig } from './config.js'

const VRM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

interface HonoLike {
  options: (path: string, handler: (c: any) => Response | Promise<Response>) => void
  get: (path: string, handler: (c: any) => Response | Promise<Response>) => void
}

function getPublicBaseUrl(config: ServerConfig): string {
  const host = config.httpHost === '0.0.0.0' || config.httpHost === '::' ? 'localhost' : config.httpHost
  return `http://${host}:${config.httpPort}`
}

export function getVrmModelUrl(config: ServerConfig, modelId: string): string {
  return `${getPublicBaseUrl(config)}/vrms/${encodeURIComponent(modelId)}.vrm`
}

export function getPoseVrmaUrl(config: ServerConfig, poseId: string): string {
  return `${getPublicBaseUrl(config)}/poses/${encodeURIComponent(poseId)}.vrma`
}

export function getVrmHttpOrigin(config: ServerConfig): string {
  return getPublicBaseUrl(config)
}

export function registerVrmHttpRoutes(app: HonoLike, config: ServerConfig): void {
  app.options('/vrms/:fileName', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    return c.body(null, 204)
  })

  app.options('/poses/:fileName', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    return c.body(null, 204)
  })

  app.get('/vrms/:fileName', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cross-Origin-Resource-Policy', 'cross-origin')

    const fileName = c.req.param('fileName')
    const match = /^(.+)\.vrm$/i.exec(fileName)
    const modelId = match?.[1]
    if (!modelId || !VRM_ID_PATTERN.test(modelId)) {
      return c.text('Not found', 404)
    }

    const filePath = join(config.playerCacheDir, 'vrms', `${modelId}.vrm`)
    if (!existsSync(filePath)) {
      return c.text('Not found', 404)
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    const size = statSync(filePath).size
    return new Response(stream, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(size),
        'Content-Type': 'model/gltf-binary',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  })

  app.get('/poses/:fileName', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cross-Origin-Resource-Policy', 'cross-origin')

    const fileName = c.req.param('fileName')
    const match = /^(.+)\.vrma$/i.exec(fileName)
    const poseId = match?.[1]
    if (!poseId || !POSE_ID_PATTERN.test(poseId)) {
      return c.text('Not found', 404)
    }

    const filePath = join(config.playerCacheDir, 'poses', `${poseId}.vrma`)
    if (!existsSync(filePath)) {
      return c.text('Not found', 404)
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    const size = statSync(filePath).size
    return new Response(stream, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(size),
        'Content-Type': 'model/gltf-binary',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  })
}
