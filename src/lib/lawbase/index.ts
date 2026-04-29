import { load } from "@tauri-apps/plugin-store"
import { readPreloadedLawPack } from "@/commands/fs"
import type { InstalledLawPack, LawArticle, LawCode, LawSearchHit, LawbasePackManifest } from "@/types/lawbase"
import type { LawbasePack } from "@/types/lawbase"

/**
 * 离线法条库运行时索引。
 *
 * - 所有法律都保存在进程内存中，支持读取随应用打包的离线法规包；
 * - 导入后的 JSON 会持久化到 Tauri plugin-store（app-state.json
 *   的 `lawbase.v1` 键下），重启自动恢复；
 * - 提供按条号精确定位、按关键字模糊搜索两种能力。
 */

const STORE_NAME = "app-state.json"
const STORE_KEY = "lawbase.v1"
const PACK_STORE_KEY = "lawbase.packManifest.v1"
const PACK_LIST_STORE_KEY = "lawbase.packList.v1"

let codes: LawCode[] = []
let packManifest: LawbasePackManifest | null = null
let installedPacks: InstalledLawPack[] = []
const codeByName: Map<string, LawCode> = new Map()
let loaded = false
const listeners = new Set<() => void>()

function normalizeName(name: string): string {
  // 去除书名号、空格、国号等变体，便于「民法典」「《民法典》」「中华人民共和国民法典」统一命中
  return name
    .trim()
    .replace(/[《》〈〉\s]/g, "")
    .replace(/中华人民共和国/g, "")
}

function buildIndex() {
  codeByName.clear()
  for (const code of codes) {
    codeByName.set(normalizeName(code.code), code)
    for (const alias of code.aliases ?? []) {
      codeByName.set(normalizeName(alias), code)
    }
  }
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

async function getStore() {
  return load(STORE_NAME, { autoSave: true })
}

/** 应用启动时调用，从持久化存储中恢复法条库。 */
export async function loadLawbase(): Promise<void> {
  try {
    const store = await getStore()
    const data = (await store.get<LawCode[]>(STORE_KEY)) ?? []
    packManifest = (await store.get<LawbasePackManifest>(PACK_STORE_KEY)) ?? null
    installedPacks = (await store.get<InstalledLawPack[]>(PACK_LIST_STORE_KEY)) ?? []
    codes = Array.isArray(data) ? data : []
  } catch {
    codes = []
    installedPacks = []
  }
  await ensurePreloadedPack()
  buildIndex()
  loaded = true
  notify()
}

async function ensurePreloadedPack(): Promise<void> {
  try {
    const raw = await readPreloadedLawPack()
    const parsed = JSON.parse(raw) as LawbasePack
    if (!parsed.manifest || !Array.isArray(parsed.codes) || parsed.codes.length === 0) return
    if (codes.length >= parsed.codes.length && packManifest?.version === parsed.manifest.version) return

    const byName = new Map(codes.map((code) => [normalizeName(code.code), code]))
    for (const code of parsed.codes) {
      byName.set(normalizeName(code.code), {
        ...code,
        source: code.source || parsed.manifest.source,
        importedAt: code.importedAt || parsed.manifest.generated_at,
      })
    }
    codes = [...byName.values()]
    packManifest = {
      ...parsed.manifest,
      laws_count: parsed.manifest.laws_count ?? parsed.codes.length,
    }
    installedPacks = mergeInstalledPacks(installedPacks, {
      ...packManifest,
      installed_at: new Date().toISOString(),
      source_kind: "preloaded",
    })
    const store = await getStore()
    await store.set(STORE_KEY, codes)
    await store.set(PACK_STORE_KEY, packManifest)
    await store.set(PACK_LIST_STORE_KEY, installedPacks)
  } catch {
    // 没有预置法规包时保持手动导入模式，不影响应用启动。
  }
}

async function persist(): Promise<void> {
  const store = await getStore()
  await store.set(STORE_KEY, codes)
}

export function isLoaded(): boolean {
  return loaded
}

export function listCodes(): LawCode[] {
  return [...codes]
}

export function getPackManifest(): LawbasePackManifest | null {
  return packManifest ? { ...packManifest } : null
}

export function getInstalledPacks(): InstalledLawPack[] {
  return [...installedPacks]
}

function mergeInstalledPacks(
  current: InstalledLawPack[],
  next: InstalledLawPack
): InstalledLawPack[] {
  const keyOf = (item: InstalledLawPack) =>
    `${item.dataset_name}::${item.version}::${item.pack_profile ?? ""}::${item.pack_tier ?? ""}`
  const nextKey = keyOf(next)
  const remaining = current.filter((item) => keyOf(item) !== nextKey)
  return [next, ...remaining]
}

/** 校验一个 LawCode 对象是否满足最小必需字段 */
export function validateLawCode(value: unknown): { ok: true; code: LawCode } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "不是有效的 JSON 对象" }
  }
  const v = value as Record<string, unknown>
  if (typeof v.code !== "string" || !v.code.trim()) {
    return { ok: false, error: "缺少 code 字段（法律全称）" }
  }
  if (!Array.isArray(v.articles)) {
    return { ok: false, error: "缺少 articles 数组" }
  }
  for (let i = 0; i < v.articles.length; i++) {
    const a = v.articles[i] as Record<string, unknown> | null
    if (!a || typeof a !== "object") {
      return { ok: false, error: `articles[${i}] 不是对象` }
    }
    if (typeof a.number !== "string" || !a.number.trim()) {
      return { ok: false, error: `articles[${i}] 缺少 number 字段（条号）` }
    }
    if (typeof a.content !== "string" || !a.content.trim()) {
      return { ok: false, error: `articles[${i}] 缺少 content 字段（条文原文）` }
    }
  }
  // 规范化
  const code: LawCode = {
    code: String(v.code).trim(),
    aliases: Array.isArray(v.aliases) ? (v.aliases as string[]).map(String) : undefined,
    effective: typeof v.effective === "string" ? v.effective : undefined,
    version: typeof v.version === "string" ? v.version : undefined,
    issuer: typeof v.issuer === "string" ? v.issuer : undefined,
    officialCategory: typeof v.officialCategory === "string" ? v.officialCategory : undefined,
    hierarchyLevel: typeof v.hierarchyLevel === "string" ? v.hierarchyLevel as LawCode["hierarchyLevel"] : undefined,
    promulgationDate: typeof v.promulgationDate === "string" ? v.promulgationDate : undefined,
    sourceEffectiveDate: typeof v.sourceEffectiveDate === "string" ? v.sourceEffectiveDate : undefined,
    sourceId: typeof v.sourceId === "string" ? v.sourceId : undefined,
    source: typeof v.source === "string" ? v.source : undefined,
    importedAt: typeof v.importedAt === "string" ? v.importedAt : undefined,
    articles: (v.articles as Record<string, unknown>[]).map((a) => ({
      number: String(a.number).trim(),
      content: String(a.content).trim(),
      chapter: typeof a.chapter === "string" ? a.chapter : undefined,
      section: typeof a.section === "string" ? a.section : undefined,
      keywords: Array.isArray(a.keywords) ? (a.keywords as string[]).map(String) : undefined,
    })),
  }
  return { ok: true, code }
}

/**
 * 导入一部法律。如果已存在同名法律，将整体覆盖（便于更新版本）。
 * 返回是否新增或替换。
 */
export async function importLawCode(code: LawCode): Promise<"added" | "replaced"> {
  const idx = codes.findIndex((c) => normalizeName(c.code) === normalizeName(code.code))
  let result: "added" | "replaced"
  if (idx >= 0) {
    codes[idx] = code
    result = "replaced"
  } else {
    codes = [...codes, code]
    result = "added"
  }
  buildIndex()
  await persist()
  notify()
  return result
}

export async function importLawPack(
  manifest: LawbasePackManifest,
  packCodes: LawCode[]
): Promise<{ added: number; replaced: number }> {
  let added = 0
  let replaced = 0
  for (const code of packCodes) {
    const idx = codes.findIndex((c) => normalizeName(c.code) === normalizeName(code.code))
    const nextCode: LawCode = {
      ...code,
      source: code.source || manifest.source,
      importedAt: new Date().toISOString(),
    }
    if (idx >= 0) {
      codes[idx] = nextCode
      replaced += 1
    } else {
      codes.push(nextCode)
      added += 1
    }
  }
  packManifest = {
    ...manifest,
    laws_count: manifest.laws_count ?? packCodes.length,
  }
  installedPacks = mergeInstalledPacks(installedPacks, {
    ...packManifest,
    installed_at: new Date().toISOString(),
    source_kind: "manual-import",
  })
  buildIndex()
  const store = await getStore()
  await store.set(STORE_KEY, codes)
  await store.set(PACK_STORE_KEY, packManifest)
  await store.set(PACK_LIST_STORE_KEY, installedPacks)
  notify()
  return { added, replaced }
}

export async function removeLawCode(codeName: string): Promise<boolean> {
  const before = codes.length
  codes = codes.filter((c) => normalizeName(c.code) !== normalizeName(codeName))
  if (codes.length === before) return false
  buildIndex()
  await persist()
  notify()
  return true
}

/**
 * 通过名称 + 条号定位。
 * - name 可以是全称、别名或《XXX》格式
 * - number 可以是 "第577条"、"577"、"第 577 条"
 */
export function findArticle(
  name: string,
  number: string
): { code: LawCode; article: LawArticle } | null {
  const code = codeByName.get(normalizeName(name))
  if (!code) return null
  const normalizedNumber = normalizeArticleNumber(number)
  const article = code.articles.find(
    (a) => normalizeArticleNumber(a.number) === normalizedNumber
  )
  return article ? { code, article } : null
}

export function normalizeArticleNumber(n: string): string {
  const digits = n.match(/\d+/)?.[0]
  return digits ?? n.replace(/\s/g, "")
}

/** 关键字模糊搜索，见 searchLaws 注释 */
export function searchLaws(query: string, limit = 30): LawSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const q_lower = q.toLowerCase()
  const hits: LawSearchHit[] = []
  for (const code of codes) {
    const nameHit =
      code.code.includes(q) || (code.aliases ?? []).some((a) => a.includes(q))
    for (const article of code.articles) {
      let score = 0
      if (normalizeArticleNumber(article.number) === normalizeArticleNumber(q)) {
        score += 50
      }
      if (nameHit) score += 30
      if (article.content.toLowerCase().includes(q_lower)) score += 10
      for (const kw of article.keywords ?? []) {
        if (kw.includes(q)) score += 5
      }
      if (article.chapter?.includes(q) || article.section?.includes(q)) {
        score += 3
      }
      if (score > 0) hits.push({ code, article, score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
