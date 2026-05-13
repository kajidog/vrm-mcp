import { VoicevoxError, VoicevoxErrorCode } from '../error.js'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete'
export type ResponseType = 'json' | 'arraybuffer' | 'text'

export interface HttpClientOptions {
  baseUrl: string
  defaultHeaders?: Record<string, string>
  timeoutMs?: number
  retry?: {
    maxRetries?: number
    baseDelayMs?: number
    retryStatuses?: number[]
  }
}

export class HttpClient {
  public readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string>
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly retryStatuses: Set<number>

  constructor(options: HttpClientOptions) {
    this.baseUrl = normalizeUrl(options.baseUrl)
    this.defaultHeaders = options.defaultHeaders ?? {}
    this.timeoutMs = options.timeoutMs ?? 30000
    this.maxRetries = options.retry?.maxRetries ?? 0
    this.baseDelayMs = options.retry?.baseDelayMs ?? 500
    this.retryStatuses = new Set(options.retry?.retryStatuses ?? [429])
  }

  public async request<T>(
    method: HttpMethod,
    endpoint: string,
    data: unknown = null,
    headers: Record<string, string> = {},
    responseType: ResponseType = 'json'
  ): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const init: RequestInit = {
        method: method.toUpperCase(),
        headers: {
          ...this.defaultHeaders,
          ...headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      }

      if (data !== null) {
        init.body = JSON.stringify(data)
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, init)
      if (!response.ok) {
        if (attempt < this.maxRetries && this.retryStatuses.has(response.status)) {
          await delay(resolveRetryDelayMs(response, this.baseDelayMs, attempt))
          continue
        }
        throw new VoicevoxError(`API request failed: ${response.status}`, VoicevoxErrorCode.API_CONNECTION_ERROR)
      }

      if (responseType === 'arraybuffer') {
        return (await response.arrayBuffer()) as T
      }
      if (responseType === 'text') {
        return (await response.text()) as T
      }
      return (await response.json()) as T
    }
    throw new VoicevoxError('API request failed', VoicevoxErrorCode.API_CONNECTION_ERROR)
  }
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function resolveRetryDelayMs(response: Response, baseDelayMs: number, attempt: number): number {
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = parseRetryAfterMs(retryAfter)
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 10_000)
  return baseDelayMs * 2 ** attempt
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(value)
  if (Number.isNaN(dateMs)) return null
  return Math.max(0, dateMs - Date.now())
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
