import type { TranscriptElementValue } from "@/types/transcript"

export interface TranscriptElementAlerts {
  disputed: TranscriptElementValue[]
  missingEvidence: TranscriptElementValue[]
  settled: TranscriptElementValue[]
  disputedMessages: string[]
  missingEvidenceMessages: string[]
  questionSuggestions: string[]
  evidenceSuggestions: string[]
}

export interface TranscriptWorkPlan {
  hearingOutline: string[]
  judgeChecklist: string[]
  clerkChecklist: string[]
}

export function buildTranscriptElementAlerts(elements: TranscriptElementValue[]): TranscriptElementAlerts {
  const disputed = elements.filter((item) => item.status === "有争议")
  const missingEvidence = elements.filter((item) => item.status === "待补证")
  const settled = elements.filter((item) => item.status === "已明确")

  return {
    disputed,
    missingEvidence,
    settled,
    disputedMessages: disputed.map((item) =>
      item.summary
        ? `围绕“${item.label}”仍存在争议：${item.summary}`
        : `围绕“${item.label}”仍存在争议，建议在后续庭审中继续核对双方陈述与证据。`
    ),
    missingEvidenceMessages: missingEvidence.map((item) =>
      item.summary
        ? `“${item.label}”目前证据支撑不足：${item.summary}`
        : `“${item.label}”目前仍待补证，建议补充原件、流水、书证或其他支撑材料。`
    ),
    questionSuggestions: disputed.map((item) =>
      item.summary
        ? `下一步可围绕“${item.label}”继续发问：请双方就 ${item.description || item.label} 作出更具体说明，并逐项回应现有争议。`
        : `下一步可围绕“${item.label}”继续发问：请双方就 ${item.description || item.label} 作出更具体说明。`
    ),
    evidenceSuggestions: missingEvidence.map((item) =>
      item.summary
        ? `针对“${item.label}”建议补证：围绕 ${item.description || item.label} 补充原件、票据、流水、聊天记录或其他直接支撑材料。`
        : `针对“${item.label}”建议补证：补充能够直接证明 ${item.description || item.label} 的书证、电子数据或其他原始材料。`
    ),
  }
}

export function buildTranscriptWorkPlan(
  elements: TranscriptElementValue[],
  proceduralNotes: string[]
): TranscriptWorkPlan {
  const alerts = buildTranscriptElementAlerts(elements)

  const hearingOutline = [
    ...alerts.disputed.map((item) =>
      `围绕“${item.label}”安排重点发问，核对双方陈述、现有证据与争议点。`
    ),
    ...alerts.missingEvidence.map((item) =>
      `针对“${item.label}”提示当事人说明现有证据情况，并确认是否需要补充提交原件或其他材料。`
    ),
    ...proceduralNotes.map((item) => `程序事项注意：${item}`),
  ]

  const judgeChecklist = [
    ...alerts.disputed.map((item) =>
      `确认“${item.label}”争议属于事实争议、证据争议还是法律适用争议，并决定是否需要继续释明。`
    ),
    ...alerts.missingEvidence.map((item) =>
      `审查“${item.label}”是否需要补充举证、说明举证责任或在庭后限定补证期限。`
    ),
  ]

  const clerkChecklist = [
    ...alerts.disputed.map((item) =>
      `笔录中单列记录“${item.label}”的双方陈述、质证意见和法庭归纳。`
    ),
    ...alerts.missingEvidence.map((item) =>
      `记录“${item.label}”的补证要求、提交期限和拟补材料名称。`
    ),
    ...proceduralNotes.map((item) => `在笔录或工作日志中同步记录程序事项：${item}`),
  ]

  return {
    hearingOutline,
    judgeChecklist,
    clerkChecklist,
  }
}
