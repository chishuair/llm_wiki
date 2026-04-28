/**
 * 法律文书模板与生成模型。
 *
 * 设计要点：
 * - 模板 = 结构化章节序列。每一节要么是静态模板文本，要么是要求 LLM 按要点填写的空白；
 * - 不用自由 prompt 生成整篇，而是逐节生成，便于约束 LLM 行文范式（最高院裁判文书规范）；
 * - 模板本身是 TS 数据结构，便于以后迁移为 JSON / 让法院自定义。
 */

/** 模板分类，用于 UI 分组展示。 */
export type LegalDocCategory = "裁判" | "笔录" | "程序" | "其他"

/**
 * 章节填充来源：
 * - `static`: 直接渲染 `template` 字段，不调 LLM；
 * - `case-field`: 从案件知识库某个字段直接拷贝（如案号、当事人）；
 * - `llm`: 调用本地 LLM 生成，使用 `prompt` 给出写作要点，并注入相关案件数据 + 法条库上下文。
 */
export type LegalDocSectionKind = "static" | "case-field" | "llm"

export type CaseField =
  | "case_number"      // 案号
  | "court_name"       // 受诉法院
  | "parties"          // 当事人信息整块
  | "facts"            // 法院认定事实
  | "disputes"         // 争议焦点
  | "reasoning"        // 本院认为
  | "judgment"         // 判决主文
  | "evidence_list"    // 证据清单
  | "case_overview"    // 案情概述
  | "procedure_log"    // 审理过程
  | "hearing_transcripts" // 庭审笔录整理
  | "hearing_worksheet" // 开庭工作单

export interface LegalDocSection {
  id: string
  /** 章节标题（会渲染到最终文书里） */
  heading: string
  kind: LegalDocSectionKind
  /** static 模板文本 */
  template?: string
  /** case-field 来源 */
  source?: CaseField
  /** llm 时的写作要点提示 */
  prompt?: string
  /** 该节可被「可选」跳过 */
  optional?: boolean
}

export interface LegalDocTemplate {
  id: string
  name: string
  category: LegalDocCategory
  /** 适用场景简述 */
  description: string
  /** 推荐字体、字号（供 Word 导出用），默认仿宋 GB2312 / 小三 */
  fontFamily?: string
  fontSizePt?: number
  /** 标题（居中大字），默认是模板 name */
  heading?: string
  /** 章节序列 */
  sections: LegalDocSection[]
}

/**
 * 生成文书时收集到的案件上下文，用于喂给章节的 LLM 或静态填充。
 *
 * 字段可能为空字符串；UI 应提示法官在知识库中补齐相关页面后再生成。
 */
export interface CaseContext {
  projectPath: string
  projectName: string
  case_number: string
  court_name: string
  parties: string
  facts: string
  disputes: string
  reasoning: string
  judgment: string
  evidence_list: string
  case_overview: string
  procedure_log: string
  hearing_transcripts: string
  hearing_worksheet: string
  /** 原始材料（raw/sources/）清单与提取文本 */
  raw_sources: RawSourceFile[]
  /** 当原件文字总量过大时，给出的截断提示；用户可在 UI 看到是否被截断 */
  raw_sources_truncated: boolean
}

export interface RawSourceFile {
  /** 相对工程根的路径，例如 raw/sources/2022-合同.pdf */
  relativePath: string
  /** 文件名（含扩展名） */
  name: string
  /** 原件提取出来的完整纯文本（未截断） */
  text: string
  /** 总体字符数（用于 UI 呈现与长度判断） */
  size: number
  /** 是否需要走摘要通道（长文件） */
  needsSummary: boolean
  /** 若已生成摘要，此处保存摘要正文；否则为空 */
  summary?: string
}

export interface GeneratedSection {
  id: string
  heading: string
  content: string
  source: LegalDocSectionKind
}

export interface GeneratedDocument {
  template: LegalDocTemplate
  caseContext: CaseContext
  title: string
  sections: GeneratedSection[]
  /** 生成时间戳（ISO） */
  generatedAt: string
}
