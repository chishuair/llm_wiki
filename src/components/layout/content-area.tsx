import { useWikiStore } from "@/stores/wiki-store"
import { SettingsView } from "@/components/settings/settings-view"
import { SourcesView } from "@/components/sources/sources-view"
import { LawbaseView } from "@/components/lawbase/lawbase-view"
import { LegalDocView } from "@/components/legal-doc/legal-doc-view"
import { HearingWorkspaceView } from "@/components/hearing/hearing-workspace-view"
import { CaseDashboardView } from "@/components/dashboard/case-dashboard-view"
import { ToolsHubView } from "@/components/tools/tools-hub-view"
import { WorksheetView } from "@/components/worksheet/worksheet-view"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  switch (activeView) {
    case "dashboard":
      return <CaseDashboardView />
    case "settings":
      return <SettingsView />
    case "sources":
      return <SourcesView />
    case "lawbase":
      return <LawbaseView />
    case "transcript":
      return <HearingWorkspaceView />
    case "worksheet":
      return <WorksheetView />
    case "legal-doc":
      return <LegalDocView />
    case "tools":
    case "wiki":
    case "search":
    case "graph":
    case "lint":
    case "review":
      return <ToolsHubView />
    default:
      return <CaseDashboardView />
  }
}
