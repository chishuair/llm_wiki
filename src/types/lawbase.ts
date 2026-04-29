/**
 * 离线法条库数据模型。
 *
 * 设计目标：
 * - 纯数据、可序列化为 JSON；
 * - 支持按「法律名称 + 条号」精确定位，也支持按关键词检索；
 * - 可通过发布新的 seed JSON 或用户自定义文件扩展，不依赖外部服务。
 *
 * 通用说明：
 * - `code` 是法律/司法解释的完整名称，例如「中华人民共和国民法典」。
 *   为便于检索与书写，提供 `aliases` 列表（如「民法典」「民法」）。
 * - 条文号 `number` 建议统一形如「第577条」「第8条」；若存在「款」或
 *   「项」结构，可拆分成多条记录，或在 `content` 内段落表示。
 */
export interface LawArticle {
  /** 条号，如 "第577条"、"第8条" */
  number: string
  /** 条文原文 */
  content: string
  /** 可选：章、节定位 */
  chapter?: string
  section?: string
  /** 可选：额外关键词，用于模糊搜索时提升命中率 */
  keywords?: string[]
}

export interface LawCode {
  /** 法律全称，如 "中华人民共和国民法典" */
  code: string
  /** 常用别名，用于引用识别，如 ["民法典", "民法"] */
  aliases?: string[]
  /** 生效日期（YYYY-MM-DD） */
  effective?: string
  /** 版本/修订说明 */
  version?: string
  /** 立法机关 / 颁布机关 */
  issuer?: string
  /** 官方法规性质/类别，例如 法律、行政法规、司法解释、地方性法规 */
  officialCategory?: string
  /** 应用内展示用效力层级 */
  hierarchyLevel?: "法律" | "行政法规" | "司法解释与两高规范性文件" | "地方性法规、自治条例和单行条例" | "其他规范性文件" | "其他"
  /** 公布日期（YYYY-MM-DD），来自官方列表字段 gbrq */
  promulgationDate?: string
  /** 官方列表中的施行日期（YYYY-MM-DD），来自 sxrq */
  sourceEffectiveDate?: string
  /** 官方数据库条目标识，例如 FLK 的 bbbs */
  sourceId?: string
  /** 条文列表 */
  articles: LawArticle[]
  /** 可选：来源文件名或官方下载地址 */
  source?: string
  /** 可选：导入/下载时间 */
  importedAt?: string
}

export interface LawbasePackManifest {
  dataset_name: string
  source: string
  version: string
  generated_at: string
  pack_tier?: "core" | "topic" | "full"
  pack_profile?: string
  topic?: string
  laws_count?: number
  latest_effective?: string
}

export interface LawbasePack {
  manifest: LawbasePackManifest
  codes: LawCode[]
}

export interface InstalledLawPack extends LawbasePackManifest {
  installed_at: string
  source_kind?: "preloaded" | "manual-import"
}

/** 一次检索命中的条目（含匹配的法律信息，便于 UI 展示）。 */
export interface LawSearchHit {
  code: LawCode
  article: LawArticle
  score: number
}

/**
 * 从任意文本中识别出的单个引用。例如：
 *   "《民法典》第577条" → { raw: "《民法典》第577条", codeName: "民法典", number: "第577条" }
 */
export interface CitationMatch {
  raw: string
  codeName: string
  number: string
  /** 在原文中的偏移（start, end），方便高亮定位 */
  start: number
  end: number
}

/** 引用校验结果 */
export interface CitationValidation extends CitationMatch {
  /** true: 命中；false: 未命中（提示法官可能是幻觉/过期/误写） */
  valid: boolean
  /** 命中时返回法律和条文 */
  code?: LawCode
  article?: LawArticle
}
