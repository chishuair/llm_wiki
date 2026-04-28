import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SettingsView() {
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const [endpoint, setEndpoint] = useState(
    llmConfig.customEndpoint || llmConfig.ollamaUrl || "http://localhost:11434"
  )
  const [apiKey, setApiKey] = useState(llmConfig.apiKey || "")
  const [model, setModel] = useState(llmConfig.model || "qwen2.5:14b")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setEndpoint(llmConfig.customEndpoint || llmConfig.ollamaUrl || "http://localhost:11434")
    setApiKey(llmConfig.apiKey || "")
    setModel(llmConfig.model || "qwen2.5:14b")
  }, [llmConfig.customEndpoint, llmConfig.ollamaUrl, llmConfig.apiKey, llmConfig.model])

  async function handleSave() {
    const { saveLlmConfig } = await import("@/lib/project-store")
    const trimmedEndpoint = endpoint.trim() || "http://localhost:11434"
    const isLocalOllama = /localhost|127\.0\.0\.1/.test(trimmedEndpoint)
    const next = {
      ...llmConfig,
      provider: isLocalOllama ? ("ollama" as const) : ("custom" as const),
      apiKey: apiKey.trim(),
      customEndpoint: isLocalOllama ? "" : trimmedEndpoint,
      ollamaUrl: isLocalOllama ? trimmedEndpoint : llmConfig.ollamaUrl || "http://localhost:11434",
      model: model.trim() || "qwen2.5:14b",
    }
    setLlmConfig(next)
    await saveLlmConfig(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-xl space-y-6">
        <h2 className="text-2xl font-bold">大模型设置</h2>

        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="font-semibold">接口地址</h3>
            <p className="text-xs text-muted-foreground">
              本地部署请填写 Ollama 地址（默认 http://localhost:11434）。
              法院内网若使用共享模型服务器，请填写内网地址；OpenAI 兼容接口建议带上
              <code className="mx-1 rounded bg-muted px-1 py-0.5">/v1</code>
              前缀，例如 http://10.10.1.25:11434/v1。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="endpoint">服务地址</Label>
            <Input
              id="endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:11434 或 http://10.10.1.25:11434/v1"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="font-semibold">API Key</h3>
            <p className="text-xs text-muted-foreground">
              本地 Ollama 无需填写。调用远程模型服务时，请填写所提供的 API Key。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="仅远程服务需要填写"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="font-semibold">模型名称</h3>
            <p className="text-xs text-muted-foreground">
              例如本地 Ollama 的 qwen2.5:14b、llama3.1:8b，或远程服务的模型标识。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">模型</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="qwen2.5:14b"
            />
          </div>
        </div>

        <Button onClick={handleSave} className="w-full">
          {saved ? "已保存" : "保存设置"}
        </Button>
      </div>
    </div>
  )
}
