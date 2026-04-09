import { useEffect, useCallback, useState, useRef } from "react"
import Graph from "graphology"
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from "@react-sigma/core"
import "@react-sigma/core/lib/style.css"
import forceAtlas2 from "graphology-layout-forceatlas2"
import { Network, RefreshCw, ZoomIn, ZoomOut, Maximize, Layers, Tag, Lightbulb, AlertTriangle, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type GraphEdge, type CommunityInfo } from "@/lib/wiki-graph"
import { findSurprisingConnections, detectKnowledgeGaps, type SurprisingConnection, type KnowledgeGap } from "@/lib/graph-insights"
import { normalizePath } from "@/lib/path-utils"

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",    // blue-400
  concept: "#c084fc",   // purple-400
  source: "#fb923c",    // orange-400
  query: "#4ade80",     // green-400
  synthesis: "#f87171",  // red-400
  overview: "#facc15",  // yellow-400
  comparison: "#2dd4bf", // teal-400
  other: "#94a3b8",     // slate-400
}

const NODE_TYPE_LABELS: Record<string, string> = {
  entity: "Entity",
  concept: "Concept",
  source: "Source",
  query: "Query",
  synthesis: "Synthesis",
  overview: "Overview",
  comparison: "Comparison",
  other: "Other",
}

const COMMUNITY_COLORS = [
  "#60a5fa",  // blue-400
  "#4ade80",  // green-400
  "#fb923c",  // orange-400
  "#c084fc",  // purple-400
  "#f87171",  // red-400
  "#2dd4bf",  // teal-400
  "#facc15",  // yellow-400
  "#f472b6",  // pink-400
  "#a78bfa",  // violet-400
  "#38bdf8",  // sky-400
  "#34d399",  // emerald-400
  "#fbbf24",  // amber-400
]

type ColorMode = "type" | "community"

const BASE_NODE_SIZE = 8
const MAX_NODE_SIZE = 28

function nodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function mixColor(color1: string, color2: string, ratio: number): string {
  const hex = (c: string) => parseInt(c, 16)
  const r1 = hex(color1.slice(1, 3)), g1 = hex(color1.slice(3, 5)), b1 = hex(color1.slice(5, 7))
  const r2 = hex(color2.slice(1, 3)), g2 = hex(color2.slice(3, 5)), b2 = hex(color2.slice(5, 7))
  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function nodeSize(linkCount: number, maxLinks: number): number {
  if (maxLinks === 0) return BASE_NODE_SIZE
  const ratio = linkCount / maxLinks
  return BASE_NODE_SIZE + Math.sqrt(ratio) * (MAX_NODE_SIZE - BASE_NODE_SIZE)
}

// --- Inner components ---

// Cache computed node positions so re-renders don't re-layout
const positionCache = new Map<string, { x: number; y: number }>()
let lastLayoutDataKey = ""

function GraphLoader({ nodes, edges, colorMode }: { nodes: GraphNode[]; edges: GraphEdge[]; colorMode: ColorMode }) {
  const loadGraph = useLoadGraph()

  useEffect(() => {
    const dataKey = nodes.map((n) => n.id).sort().join(",") + "|" + edges.length
    const needsLayout = dataKey !== lastLayoutDataKey

    const graph = new Graph()
    const maxLinks = Math.max(...nodes.map((n) => n.linkCount), 1)

    for (const node of nodes) {
      const cached = positionCache.get(node.id)
      const color = colorMode === "community"
        ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
        : nodeColor(node.type)
      graph.addNode(node.id, {
        x: cached?.x ?? Math.random() * 100,
        y: cached?.y ?? Math.random() * 100,
        size: nodeSize(node.linkCount, maxLinks),
        color,
        label: node.label,
        nodeType: node.type,
        nodePath: node.path,
        community: node.community,
      })
    }

    // Calculate max weight for normalization
    const maxWeight = Math.max(...edges.map((e) => e.weight), 1)

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        const edgeKey = `${edge.source}->${edge.target}`
        if (!graph.hasEdge(edgeKey) && !graph.hasEdge(`${edge.target}->${edge.source}`)) {
          const normalizedWeight = edge.weight / maxWeight // 0..1
          const size = 0.5 + normalizedWeight * 3.5 // 0.5..4
          // Stronger relationships → darker color
          const alpha = Math.round(40 + normalizedWeight * 180) // 40..220
          const color = `rgba(100,116,139,${alpha / 255})` // slate-500 with variable opacity
          graph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
            color,
            size,
            weight: edge.weight,
          })
        }
      }
    }

    // Only run expensive ForceAtlas2 layout when data actually changed
    if (needsLayout && nodes.length > 1) {
      const settings = forceAtlas2.inferSettings(graph)
      forceAtlas2.assign(graph, {
        iterations: 150,
        settings: {
          ...settings,
          gravity: 1,
          scalingRatio: 2,
          strongGravityMode: true,
          barnesHutOptimize: nodes.length > 50,
        },
      })
      lastLayoutDataKey = dataKey

      // Cache computed positions
      graph.forEachNode((nodeId, attrs) => {
        positionCache.set(nodeId, { x: attrs.x, y: attrs.y })
      })
    }

    loadGraph(graph)
  }, [loadGraph, nodes, edges, colorMode])

  return null
}

function EventHandler({ onNodeClick }: { onNodeClick: (nodeId: string) => void }) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNodeClick(node),
      enterNode: ({ node }) => {
        const container = sigma.getContainer()
        container.style.cursor = "pointer"
        const graph = sigma.getGraph()
        graph.setNodeAttribute(node, "hovering", true)
        const neighbors = new Set(graph.neighbors(node))
        neighbors.add(node)
        graph.forEachNode((n) => {
          if (!neighbors.has(n)) graph.setNodeAttribute(n, "dimmed", true)
        })
        graph.forEachEdge((e, _attrs, source, target) => {
          if (source !== node && target !== node) {
            graph.setEdgeAttribute(e, "dimmed", true)
          } else {
            graph.setEdgeAttribute(e, "highlighted", true)
          }
        })
        sigma.refresh()
      },
      leaveNode: () => {
        const container = sigma.getContainer()
        container.style.cursor = "default"
        const graph = sigma.getGraph()
        graph.forEachNode((n) => {
          graph.removeNodeAttribute(n, "hovering")
          graph.removeNodeAttribute(n, "dimmed")
        })
        graph.forEachEdge((e) => {
          graph.removeEdgeAttribute(e, "dimmed")
          graph.removeEdgeAttribute(e, "highlighted")
        })
        sigma.refresh()
      },
    })
  }, [registerEvents, sigma, onNodeClick])

  return null
}

function ZoomControls() {
  const sigma = useSigma()

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedZoom({ duration: 200 })
        }}
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedUnzoom({ duration: 200 })
        }}
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedReset({ duration: 300 })
        }}
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// --- Main component ---

export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [surprisingConns, setSurprisingConns] = useState<SurprisingConnection[]>([])
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredType, setHoveredType] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>("type")
  const [showInsights, setShowInsights] = useState(false)
  const lastLoadedVersion = useRef(-1)

  const loadGraph = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const result = await buildWikiGraph(normalizePath(project.path))
      setNodes(result.nodes)
      setEdges(result.edges)
      setCommunities(result.communities)
      setSurprisingConns(findSurprisingConnections(result.nodes, result.edges, result.communities))
      setKnowledgeGaps(detectKnowledgeGaps(result.nodes, result.edges, result.communities))
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build graph"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (dataVersion !== lastLoadedVersion.current) {
      loadGraph()
    }
  }, [loadGraph, dataVersion])

  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      try {
        const content = await readFile(node.path)
        setSelectedFile(node.path)
        setFileContent(content)
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    },
    [nodes, setSelectedFile, setFileContent],
  )

  // Count nodes by type for legend
  const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">Open a project to view the graph</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">Building graph...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadGraph}>Retry</Button>
      </div>
    )
  }

  if (!loading && nodes.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">No pages yet</p>
        <p className="text-xs">Import sources to start building the knowledge graph</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Knowledge Graph</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">{nodes.length} pages</span>
            <span className="rounded bg-muted px-1.5 py-0.5">{edges.length} links</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={colorMode === "type" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("type")}
            className="text-xs gap-1 h-7"
          >
            <Tag className="h-3 w-3" />
            Type
          </Button>
          <Button
            variant={colorMode === "community" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("community")}
            className="text-xs gap-1 h-7"
          >
            <Layers className="h-3 w-3" />
            Community
          </Button>
          {(surprisingConns.length > 0 || knowledgeGaps.length > 0) && (
            <Button
              variant={showInsights ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowInsights((v) => !v)}
              className="text-xs gap-1 h-7"
            >
              <Lightbulb className="h-3 w-3" />
              Insights
              <span className="rounded bg-muted px-1 text-[10px]">
                {surprisingConns.length + knowledgeGaps.length}
              </span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={loadGraph} className="text-xs gap-1 h-7">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="relative flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
        <SigmaContainer
          style={{ width: "100%", height: "100%", background: "transparent" }}
          settings={{
            renderEdgeLabels: true,
            defaultEdgeColor: "#cbd5e1",
            defaultNodeColor: "#94a3b8",
            labelSize: 13,
            labelWeight: "bold",
            labelColor: { color: "#1e293b" },
            labelDensity: 0.4,
            labelRenderedSizeThreshold: 6,
            stagePadding: 30,
            nodeReducer: (_node, attrs) => {
              const result = { ...attrs }
              if (attrs.hovering) {
                result.size = (attrs.size ?? BASE_NODE_SIZE) * 1.4
                result.zIndex = 10
                result.forceLabel = true
              }
              if (attrs.dimmed) {
                result.color = mixColor(attrs.color ?? "#94a3b8", "#e2e8f0", 0.75)
                result.label = ""
                result.size = (attrs.size ?? BASE_NODE_SIZE) * 0.6
              }
              return result
            },
            edgeReducer: (_edge, attrs) => {
              const result = { ...attrs }
              if (attrs.dimmed) {
                result.color = "#f1f5f9"
                result.size = 0.3
              }
              if (attrs.highlighted) {
                // Highlighted edges: show stronger with weight-based thickness
                const w = attrs.weight ?? 1
                result.color = "#1e293b"
                result.size = Math.max(2, (attrs.size ?? 1) * 1.5)
                result.label = `relevance: ${w.toFixed(1)}`
                result.forceLabel = true
              }
              return result
            },
          }}
        >
          <GraphLoader nodes={nodes} edges={edges} colorMode={colorMode} />
          <EventHandler onNodeClick={handleNodeClick} />
          <ZoomControls />
        </SigmaContainer>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 rounded-lg border bg-background/90 backdrop-blur-sm px-3 py-2 text-xs shadow-sm max-w-[260px]">
          {colorMode === "type" ? (
            <>
              <div className="mb-1.5 font-semibold text-foreground">Node Types</div>
              <div className="flex flex-col gap-0.5">
                {Object.entries(NODE_TYPE_LABELS)
                  .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                  .map(([type, label]) => (
                    <div
                      key={type}
                      className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                      onMouseEnter={() => setHoveredType(type)}
                      onMouseLeave={() => setHoveredType(null)}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{
                          backgroundColor: NODE_TYPE_COLORS[type],
                          boxShadow: `0 0 4px ${hexToRgba(NODE_TYPE_COLORS[type] ?? "#94a3b8", 0.4)}`,
                        }}
                      />
                      <span className={hoveredType === type ? "text-foreground font-medium" : "text-muted-foreground"}>
                        {label}
                      </span>
                      <span className="text-muted-foreground/60 ml-auto">{typeCounts[type]}</span>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-1.5 font-semibold text-foreground">Communities</div>
              <div className="flex flex-col gap-0.5">
                {communities.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                      style={{
                        backgroundColor: COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length],
                        boxShadow: `0 0 4px ${hexToRgba(COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length], 0.4)}`,
                      }}
                    />
                    <span className="text-muted-foreground truncate" title={c.topNodes.join(", ")}>
                      {c.topNodes[0] ?? `Cluster ${c.id}`}
                    </span>
                    <span className="text-muted-foreground/60 ml-auto shrink-0">{c.nodeCount}</span>
                    {c.cohesion < 0.15 && c.nodeCount >= 3 && (
                      <span className="text-amber-500 shrink-0" title={`Low cohesion: ${c.cohesion.toFixed(2)}`}>!</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Insights Panel */}
        {showInsights && (
          <div className="absolute bottom-3 right-14 w-72 max-h-[60%] overflow-y-auto rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 text-xs shadow-lg">
            {surprisingConns.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-foreground">
                  <Link2 className="h-3.5 w-3.5 text-blue-500" />
                  Surprising Connections
                </div>
                <div className="flex flex-col gap-1.5">
                  {surprisingConns.map((conn, i) => (
                    <div key={i} className="rounded border px-2 py-1.5 bg-muted/30">
                      <div className="font-medium text-foreground">
                        {conn.source.label} ↔ {conn.target.label}
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {conn.reasons.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {knowledgeGaps.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Knowledge Gaps
                </div>
                <div className="flex flex-col gap-1.5">
                  {knowledgeGaps.map((gap, i) => (
                    <div key={i} className="rounded border px-2 py-1.5 bg-muted/30">
                      <div className="font-medium text-foreground">{gap.title}</div>
                      <div className="text-muted-foreground mt-0.5">{gap.description}</div>
                      <div className="text-muted-foreground/80 mt-1 italic">{gap.suggestion}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
