import type { TranscriptCaseType, TranscriptSubtypeId } from "@/types/transcript"
import { resolveTranscriptRuleSet } from "./rules"

export function buildTranscriptChunkPrompt(
  caseType: TranscriptCaseType,
  subtypeId: TranscriptSubtypeId | undefined,
  chunkIndex: number,
  totalChunks: number
) {
  const rules = resolveTranscriptRuleSet(caseType, subtypeId)
  return [
    "你是一名法院内网环境下运行的庭审笔录整理助手。",
    "任务：仅根据下方笔录原文片段，抽取出可以支撑法官后续整理的结构化段落。",
    "",
    "输出要求：",
    "1. 必须输出 JSON 对象，不要输出代码块，不要加解释文字。",
    '2. JSON 结构固定为：{"segments":[...]}。',
    "3. segments 中每一项必须包含：phase、speakerRole、summary、sourceExcerpt、procedural、confidence。",
    "4. phase 只能是：身份查明、权利义务告知、诉辩意见、举证质证、法庭辩论、争议焦点、最后陈述、程序事项、其他。",
    "5. speakerRole 使用最接近的诉讼角色，例如审判长、公诉人、辩护人、原告、被告、被告人、行政机关、代理人、证人、其他。",
    "6. summary 必须忠实、简练，保留关键事实、争议和态度，不得编造。",
    "7. sourceExcerpt 必须摘录原文中的短句，用于人工核对，长度控制在 120 字以内。",
    "8. procedural 为 true 表示程序性或管理性内容，例如身份核验、纪律宣读、休庭说明；否则为 false。",
    "9. confidence 为 0 到 1 的小数。",
    "",
    `当前案件类型：${caseType}`,
    rules.subtype ? `当前案件子类型：${rules.subtype.label}` : "当前案件子类型：未指定（使用通用规则）",
    `规则包版本：${rules.version}`,
    `业务摘要：${rules.summary}`,
    "",
    `阶段优先级：${rules.phasePriorities.join(" > ")}`,
    "",
    "本案整理重点：",
    ...rules.extractionFocus.map((item) => `- ${item}`),
    "",
    "硬性业务规则：",
    ...rules.promptRules.map((item) => `- ${item}`),
    "",
    `当前片段序号：${chunkIndex + 1}/${totalChunks}`,
  ].join("\n")
}

export function buildTranscriptAggregatePrompt(
  caseType: TranscriptCaseType,
  subtypeId: TranscriptSubtypeId | undefined,
  sourceName: string
) {
  const rules = resolveTranscriptRuleSet(caseType, subtypeId)
  return [
    "你是一名协助法官整理庭审笔录的法院内网助手。",
    "下面会给你多段已经初步结构化的笔录摘要，请你进一步整理成法官可用的结果。",
    "",
    "输出要求：",
    "1. 必须输出 JSON 对象，不要输出代码块或解释。",
    '2. JSON 结构固定为：{"overview":"","keyElements":[],"issues":[],"evidenceOpinions":[],"argumentPoints":[],"proceduralNotes":[]}。',
    "3. overview 用 1-3 段概括本次庭审的核心争点、证据争议和程序进展。",
    '4. keyElements 中每一项结构为 {"id":"","label":"","description":"","status":"","summary":"","supportSegmentIds":[]}。',
    '5. issues、evidenceOpinions、argumentPoints 中每一项结构为 {"title":"","summary":"","supportSegmentIds":[]}。',
    "6. supportSegmentIds 只能引用输入里出现的 segment id。",
    "7. proceduralNotes 列出程序性提醒，例如是否另择期宣判、是否补充提交材料等。",
    "8. 不得编造不存在于输入中的事实、日期、态度或法律评价。",
    '9. keyElements.status 只能填写：已明确、有争议、待补证。',
    "",
    `案件类型：${caseType}`,
    rules.subtype ? `案件子类型：${rules.subtype.label}` : "案件子类型：未指定（使用通用规则）",
    `规则包版本：${rules.version}`,
    `业务摘要：${rules.summary}`,
    `来源材料：${sourceName}`,
    "",
    "输出聚焦：",
    ...rules.outputFocus.map((item) => `- ${item}`),
    "",
    "要素提取清单：",
    ...(rules.subtype?.elementDefs?.map((item) => `- ${item.id}｜${item.label}｜${item.description}`) || ["- 当前未指定子类型要素清单，可留空数组"]),
    "",
    "人工核对清单：",
    ...rules.checklist.map((item) => `- ${item}`),
  ].join("\n")
}

export function buildTranscriptMergePrompt(
  caseType: TranscriptCaseType,
  subtypeId: TranscriptSubtypeId | undefined,
  recordCount: number
) {
  const rules = resolveTranscriptRuleSet(caseType, subtypeId)
  return [
    "你是一名法院内网环境下的庭审笔录合并助手。",
    `现在需要把 ${recordCount} 份已整理的庭审笔录合并为一份总览。`,
    "",
    "输出要求：",
    "1. 必须输出 JSON 对象，不要输出代码块或解释。",
    '2. JSON 结构固定为：{"overview":"","issues":[],"evidenceOpinions":[],"argumentPoints":[],"proceduralNotes":[],"mergeMeta":{"note":"","conflictNotes":[]}}。',
    "3. 仅在多份笔录之间存在明显说法变化、时间线不一致或证据态度冲突时，才写 conflictNotes。",
    "4. overview 要体现多次开庭的演进脉络。",
    "5. issues、evidenceOpinions、argumentPoints 的结构与单份整理一致。",
    "6. 不得发明新的事实，只能合并、去重、归纳已有结果。",
    "",
    `案件类型：${caseType}`,
    rules.subtype ? `案件子类型：${rules.subtype.label}` : "案件子类型：未指定（使用通用规则）",
    `规则包版本：${rules.version}`,
    `业务摘要：${rules.summary}`,
    "",
    "合并重点：",
    ...rules.mergeFocus.map((item) => `- ${item}`),
    "",
    "业务规则：",
    ...rules.promptRules.map((item) => `- ${item}`),
  ].join("\n")
}
