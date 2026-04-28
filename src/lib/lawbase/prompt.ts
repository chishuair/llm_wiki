import type { LawArticle, LawCode } from "@/types/lawbase"
import { listCodes } from "."

/**
 * LLM 引用法条时的硬约束机制。
 *
 * 原则：
 * - 法官不允许 LLM 凭空引用任何法律；
 * - LLM 只能引用本地「法律依据」库中实际存在的条款；
 * - 一旦本地库里没有对应内容，LLM 必须直接输出下方的「库缺标识」，
 *   让应用自动提醒法官导入相关法律，而不是让模型继续编造。
 */

/**
 * 库缺标识语。应用在 LLM 输出中检测到此语时，会向法官展示「请导入相关法律」的提示。
 * 保持简短且具辨识度，避免与普通行文混淆。
 */
export const LAWBASE_MISSING_SENTINEL =
  "【本地法条库未收录相关法律依据，请先在「法律依据」中导入后重试】"

/**
 * 构造法条库约束提示片段，供 LLM system prompt 注入。
 *
 * - 若库为空：输出「库为空」说明 + 规定任何法律问题都必须先回复库缺标识语；
 * - 若库中有条文：只列出条号与简短标题（而非全文），避免把 prompt 撑爆；
 *   要求 LLM 在使用法条前回到本清单确认；
 * - 无论哪种情况，都严格禁止编造法律名或条文号。
 */
export function buildLawbasePromptSection(): string {
  const codes = listCodes()
  const header = [
    "## 法律引用约束（重要）",
    "- 你只能引用「本地法条库」中明确列出的法律和条款。",
    "- 引用时必须使用标准格式：《法律全称》第N条。",
    "- 严禁编造法律名、条文号或条文内容。",
    "- 不得依据未列入本库的法律（包括过期版本、相似法律、外部检索等）。",
    `- 如果本地库中没有可适用的法律或条款，你必须原样输出以下提示，不得继续编造：\n  ${LAWBASE_MISSING_SENTINEL}`,
  ].join("\n")

  if (codes.length === 0) {
    return [
      header,
      "",
      "本地法条库当前为空。如果用户的问题涉及任何法律条款，请直接返回上述「库缺标识」，不要给出具体法律引用。",
    ].join("\n")
  }

  const lines: string[] = [header, "", "## 本地法条库"]
  for (const code of codes) {
    lines.push("")
    const meta: string[] = []
    if (code.version) meta.push(code.version)
    if (code.effective) meta.push(`${code.effective} 起施行`)
    const metaSuffix = meta.length ? `（${meta.join(" · ")}）` : ""
    lines.push(`### ${code.code}${metaSuffix}`)
    if (code.aliases && code.aliases.length) {
      lines.push(`别名：${code.aliases.join("、")}`)
    }
    lines.push(articleListForCode(code.articles))
  }
  lines.push(
    "",
    "引用前请回到上方清单核实：条号是否存在、法律名是否一致。若没有把握，立即使用「库缺标识」。"
  )
  return lines.join("\n")
}

/**
 * 把单部法律的条款列表紧凑排列：`第N条：条文前40字…`
 * - 给 LLM 足够信息判断能不能套用；
 * - 不塞入完整条文，避免整个 prompt 过大。
 */
function articleListForCode(articles: LawArticle[]): string {
  const summaries: string[] = []
  for (const a of articles) {
    const snippet = a.content.replace(/\s+/g, " ").slice(0, 40)
    summaries.push(`- ${a.number}：${snippet}…`)
  }
  return summaries.join("\n")
}

/** LLM 输出中是否包含库缺标识。 */
export function detectMissingLawbaseSignal(text: string): boolean {
  if (!text) return false
  return text.includes(LAWBASE_MISSING_SENTINEL)
}
