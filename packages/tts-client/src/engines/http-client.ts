import { VoicevoxError, VoicevoxErrorCode } from '../error.js'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete'
export type ResponseType = 'json' | 'arraybuffer' | 'text'

export interface HttpClientOptions {
  baseUrl: string
  defaultHeaders?: Record<string, string>
  timeoutMs?: number
}

export class HttpClient {
  public readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string>
  private readonly timeoutMs: number

  constructor(options: HttpClientOptions) {
    this.baseUrl = normalizeUrl(options.baseUrl)
    this.defaultHeaders = options.defaultHeaders ?? {}
    this.timeoutMs = options.timeoutMs ?? 30000
  }

  public async request<T>(
    method: HttpMethod,
    endpoint: string,
    data: unknown = null,
    headers: Record<string, string> = {},
    responseType: ResponseType = 'json'
  ): Promise<T> {
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
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}
