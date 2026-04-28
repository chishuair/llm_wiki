import { load } from "@tauri-apps/plugin-store"
import { LEGAL_DOC_TEMPLATES } from "./templates"
import type { LegalDocSection, LegalDocTemplate } from "@/types/legal-doc"

/**
 * 法律文书模板注册表：
 * - 内置模板随应用发布，永远存在，不可删除；
 * - 用户导入的 JSON 模板持久化到 Tauri plugin-store
 *   （`app-state.json` 的 `legal-doc-templates.v1` 键下）；
 * - 启动时自动加载；导入时覆盖同 id 的自定义模板；
 * - 通过 subscribe 推送列表变更，UI 可监听后刷新。
 */

const STORE_NAME = "app-state.json"
const STORE_KEY = "legal-doc-templates.v1"

let builtinTemplates: LegalDocTemplate[] = [...LEGAL_DOC_TEMPLATES]
let customTemplates: LegalDocTemplate[] = []
let loaded = false
const listeners = new Set<() => void>()

async function getStore() {
  return load(STORE_NAME, { autoSave: true })
}

function notify() {
  for (const fn of listeners) fn()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 应用启动时调用，从持久化存储中恢复自定义模板。 */
export async function loadCustomTemplates(): Promise<void> {
  try {
    const store = await getStore()
    const data = (await store.get<LegalDocTemplate[]>(STORE_KEY)) ?? []
    customTemplates = Array.isArray(data) ? data : []
  } catch {
    customTemplates = []
  }
  loaded = true
  notify()
}

async function persist(): Promise<void> {
  const store = await getStore()
  await store.set(STORE_KEY, customTemplates)
}

export function isLoaded(): boolean {
  return loaded
}

export function listTemplates(): Array<LegalDocTemplate & { builtin: boolean }> {
  return [
    ...builtinTemplates.map((t) => ({ ...t, builtin: true })),
    ...customTemplates.map((t) => ({ ...t, builtin: false })),
  ]
}

export function findTemplate(id: string): LegalDocTemplate | null {
  const custom = customTemplates.find((t) => t.id === id)
  if (custom) return custom
  return builtinTemplates.find((t) => t.id === id) ?? null
}

/** 校验模板 JSON 是否合法。 */
export function validateTemplate(value: unknown): { ok: true; template: LegalDocTemplate } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "不是有效的 JSON 对象" }
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || !v.id.trim()) return { ok: false, error: "缺少 id" }
  if (typeof v.name !== "string" || !v.name.trim()) return { ok: false, error: "缺少 name" }
  if (!["裁判", "笔录", "程序", "其他"].includes(v.category as string)) {
    return { ok: false, error: "category 必须为「裁判/笔录/程序/其他」之一" }
  }
  if (!Array.isArray(v.sections)) return { ok: false, error: "缺少 sections 数组" }
  for (let i = 0; i < v.sections.length; i++) {
    const s = v.sections[i] as Record<string, unknown>
    if (!s || typeof s !== "object") return { ok: false, error: `sections[${i}] 不是对象` }
    if (typeof s.id !== "string") return { ok: false, error: `sections[${i}].id 缺失` }
    if (typeof s.heading !== "string") return { ok: false, error: `sections[${i}].heading 缺失` }
    if (!["static", "case-field", "llm"].includes(s.kind as string)) {
      return { ok: false, error: `sections[${i}].kind 非法` }
    }
  }
  const template: LegalDocTemplate = {
    id: String(v.id).trim(),
    name: String(v.name).trim(),
    category: v.category as LegalDocTemplate["category"],
    description: typeof v.description === "string" ? v.description : "",
    fontFamily: typeof v.fontFamily === "string" ? v.fontFamily : undefined,
    fontSizePt: typeof v.fontSizePt === "number" ? v.fontSizePt : undefined,
    heading: typeof v.heading === "string" ? v.heading : undefined,
    sections: (v.sections as Record<string, unknown>[]).map((s) => ({
      id: String(s.id),
      heading: String(s.heading),
      kind: s.kind as LegalDocSection["kind"],
      template: typeof s.template === "string" ? s.template : undefined,
      source: typeof s.source === "string" ? (s.source as LegalDocSection["source"]) : undefined,
      prompt: typeof s.prompt === "string" ? s.prompt : undefined,
      optional: typeof s.optional === "boolean" ? s.optional : undefined,
    })),
  }
  return { ok: true, template }
}

export async function importTemplate(t: LegalDocTemplate): Promise<"added" | "replaced"> {
  // 内置模板不能被覆盖（即使同 id）
  if (builtinTemplates.some((b) => b.id === t.id)) {
    // 为避免冲突，自动在 id 后加 -custom
    t = { ...t, id: `${t.id}-custom`, name: `${t.name}（自定义）` }
  }
  const idx = customTemplates.findIndex((c) => c.id === t.id)
  let result: "added" | "replaced"
  if (idx >= 0) {
    customTemplates[idx] = t
    result = "replaced"
  } else {
    customTemplates = [...customTemplates, t]
    result = "added"
  }
  await persist()
  notify()
  return result
}

export async function removeTemplate(id: string): Promise<boolean> {
  const before = customTemplates.length
  customTemplates = customTemplates.filter((c) => c.id !== id)
  if (customTemplates.length === before) return false
  await persist()
  notify()
  return true
}
