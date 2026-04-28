import { create } from "zustand"

export type HearingWorkspaceTab = "evidence" | "transcript" | "elements" | "disputes"

interface HearingWorkspaceState {
  activeTab: HearingWorkspaceTab
  focusTranscriptPath: string | null
  focusElementId: string | null
  focusText: string | null
  focusEvidenceId: string | null
  setActiveTab: (tab: HearingWorkspaceTab) => void
  setFocusTranscriptPath: (path: string | null) => void
  setFocusEvidenceId: (id: string | null) => void
  jumpTo: (
    tab: HearingWorkspaceTab,
    transcriptPath?: string | null,
    focusElementId?: string | null,
    focusText?: string | null,
    focusEvidenceId?: string | null
  ) => void
}

export const useHearingWorkspaceStore = create<HearingWorkspaceState>((set) => ({
  activeTab: "evidence",
  focusTranscriptPath: null,
  focusElementId: null,
  focusText: null,
  focusEvidenceId: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setFocusTranscriptPath: (focusTranscriptPath) => set({ focusTranscriptPath }),
  setFocusEvidenceId: (focusEvidenceId) => set({ focusEvidenceId }),
  jumpTo: (activeTab, focusTranscriptPath = null, focusElementId = null, focusText = null, focusEvidenceId = null) =>
    set({ activeTab, focusTranscriptPath, focusElementId, focusText, focusEvidenceId }),
}))
