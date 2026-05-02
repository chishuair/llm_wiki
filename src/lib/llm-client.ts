import type { LlmConfig } from "@/stores/wiki-store"
import { getProviderConfig } from "./llm-providers"

export type { ChatMessage } from "./llm-providers"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

const DECODER = new TextDecoder()
// 兼顾稳定性与多数本地/云端模型网关限制，接近 6MB 时自动压缩消息。
const MAX_REQUEST_BODY_BYTES = 5_500_000
const OVERSIZE_NOTE = "\n\n[...内容过长，已自动截断以适配请求大小限制。建议启用分块摘要/分批解析以获得完整结果...]"

function bodyByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function prepareBodyForSizeLimit(body: Record<string, unknown>): { serializedBody: string; bodyBytes: number; truncated: boolean } | null {
  const direct = JSON.stringify(body)
  const directBytes = bodyByteLength(direct)
  if (directBytes <= MAX_REQUEST_BODY_BYTES) {
    return { serializedBody: direct, bodyBytes: directBytes, truncated: false }
  }

  const messagesRaw = body.messages
  if (!Array.isArray(messagesRaw)) return null

  const messages = messagesRaw.map((m) => ({ ...(m as Record<string, unknown>) }))
  let truncated = false

  for (let pass = 0; pass < 30; pass++) {
    const candidateBody = { ...body, messages }
    const serialized = JSON.stringify(candidateBody)
    const bytes = bodyByteLength(serialized)
    if (bytes <= MAX_REQUEST_BODY_BYTES) {
      return { serializedBody: serialized, bodyBytes: bytes, truncated }
    }

    let longestIdx = -1
    let longestLen = 0
    for (let i = 0; i < messages.length; i++) {
      const content = messages[i].content
      if (typeof content !== "string") continue
      if (content.length > longestLen) {
        longestLen = content.length
        longestIdx = i
      }
    }

    if (longestIdx === -1 || longestLen < 800) break

    const current = String(messages[longestIdx].content ?? "")
    const base = current.includes(OVERSIZE_NOTE) ? current.replace(OVERSIZE_NOTE, "") : current
    const keepLength = Math.max(600, Math.floor(base.length * 0.75))
    messages[longestIdx].content = base.slice(0, keepLength) + OVERSIZE_NOTE
    truncated = true
  }

  return null
}

function parseLines(chunk: Uint8Array, buffer: string): [string[], string] {
  const text = buffer + DECODER.decode(chunk, { stream: true })
  const lines = text.split("\n")
  const remaining = lines.pop() ?? ""
  return [lines, remaining]
}

async function completeViaTauriProxy(args: {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core")
  return await invoke<string>("llm_chat_completion", { request: args })
}

function canUseTauriProxy(provider: LlmConfig["provider"]): boolean {
  return provider === "ollama" || provider === "custom" || provider === "openai" || provider === "minimax"
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === "TypeError" ||
    err.message === "Failed to fetch" ||
    err.message === "Load failed" ||
    err.message.includes("NetworkError")
  )
}

export async function streamChat(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  /**
   * Extra fields to merge into the request body. Use for provider-specific
   * knobs like `temperature`, `top_p`, `max_tokens`. Callers that need
   * strict format adherence (e.g. ingest stage 2 emitting FILE blocks)
   * should pass `{ temperature: 0.1 }` to reduce sampling variance.
   */
  requestOverrides?: Record<string, unknown>,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks
  const providerConfig = getProviderConfig(config)

  // Create a combined signal: user abort OR 15-minute timeout
  const timeoutMs = 15 * 60 * 1000 // 15 minutes — some models with large context need a long time
  let combinedSignal = signal
  let timeoutController: AbortController | undefined

  if (typeof AbortSignal.timeout === "function") {
    // Combine user signal with timeout
    timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController?.abort(), timeoutMs)

    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId)
        timeoutController?.abort()
      })
    }
    combinedSignal = timeoutController.signal
  }

  let response: Response
  let serializedBody = ""
  try {
    const baseBody = providerConfig.buildBody(messages) as Record<string, unknown>
    const body = requestOverrides ? { ...baseBody, ...requestOverrides } : baseBody
    const prepared = prepareBodyForSizeLimit(body)
    if (!prepared) {
      const serializedBody = JSON.stringify(body)
      const bodyBytes = bodyByteLength(serializedBody)
      onError(new Error(
        `本次请求内容约 ${(bodyBytes / 1048576).toFixed(1)} MB，超过安全上限。系统已尝试自动压缩但仍失败，请改用分批解析或先做文档分块后重试。`
      ))
      return
    }
    serializedBody = prepared.serializedBody
    const { truncated } = prepared
    if (truncated) {
      console.warn("[llm-client] request body exceeded size limit, auto-truncated messages")
    }
    response = await fetch(providerConfig.url, {
      method: "POST",
      headers: providerConfig.headers,
      body: serializedBody,
      signal: combinedSignal,
      // @ts-ignore — keepalive hint for Tauri webview
      keepalive: false,
    })
  } catch (err) {
    if (isNetworkFetchError(err) && canUseTauriProxy(config.provider) && serializedBody) {
      try {
        const text = await completeViaTauriProxy({
          url: providerConfig.url,
          headers: providerConfig.headers,
          body: JSON.parse(serializedBody) as Record<string, unknown>,
        })
        if (text) onToken(text)
        onDone()
        return
      } catch (proxyErr) {
        const original = err instanceof Error ? err.message : String(err)
        const proxyMessage = proxyErr instanceof Error ? proxyErr.message : String(proxyErr)
        onError(new Error(`模型服务连接失败：${proxyMessage}（前端直连错误：${original}）`))
        return
      }
    }
    if (err instanceof Error && (err.name === "AbortError" || err.message === "Load failed")) {
      // Check if it was user-initiated abort
      if (signal?.aborted) {
        onDone()
        return
      }
      // Otherwise it's a timeout or network error
      onError(new Error("请求超时或网络异常。可稍后重试，或更换响应更快的模型。"))
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
    return
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}: ${response.statusText}`
    try {
      const body = await response.text()
      if (body) errorDetail += ` — ${body}`
    } catch {
      // ignore body read failure
    }
    onError(new Error(errorDetail))
    return
  }

  if (!response.body) {
    onError(new Error("模型返回为空（response body 为 null）"))
    return
  }

  const reader = response.body.getReader()
  let lineBuffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        if (lineBuffer.trim()) {
          const token = providerConfig.parseStream(lineBuffer.trim())
          if (token !== null) onToken(token)
        }
        break
      }

      const [lines, remaining] = parseLines(value, lineBuffer)
      lineBuffer = remaining

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const token = providerConfig.parseStream(trimmed)
        if (token !== null) onToken(token)
      }
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || (signal?.aborted))) {
      onDone()
      return
    }
    if (err instanceof Error && err.message === "Load failed") {
      // WebKit network error during streaming — connection dropped
      onError(new Error("流式输出过程中连接中断，请重试。"))
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
  } finally {
    reader.releaseLock()
  }
}
