import { useEffect, useRef, useState } from "react"

/**
 * 应用内自绘右键菜单，覆盖 webview 默认的英文系统菜单。
 *
 * 功能：
 * - 选中文字后右键：复制 / 全选 / 朗读（macOS）
 * - 输入框右键：剪切 / 复制 / 粘贴 / 全选
 * - 超链接右键：打开链接（使用系统默认浏览器） / 复制链接地址
 * - 其它场景右键：全选
 *
 * 与 Tauri 无关；仅用前端事件处理，保持全局一致。
 */

interface MenuItem {
  id: string
  label: string
  action: () => void
  disabled?: boolean
}

interface MenuPosition {
  x: number
  y: number
}

function getSelectedText(): string {
  return window.getSelection()?.toString() ?? ""
}

function isEditableElement(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return target.type !== "checkbox" && target.type !== "radio"
  if (target instanceof HTMLTextAreaElement) return true
  return target.isContentEditable
}

async function readClipboardSafe(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ""
  }
}

export function AppContextMenu() {
  const [menu, setMenu] = useState<{ items: MenuItem[]; pos: MenuPosition } | null>(null)
  const lastTarget = useRef<EventTarget | null>(null)
  const closeRef = useRef(() => setMenu(null))

  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      // 始终阻止默认系统菜单
      e.preventDefault()
      lastTarget.current = e.target

      const selection = getSelectedText()
      const target = e.target as HTMLElement | null
      const anchor = target?.closest("a") as HTMLAnchorElement | null
      const editable = isEditableElement(target)

      const items: MenuItem[] = []

      if (editable) {
        const el = target as HTMLInputElement | HTMLTextAreaElement | HTMLElement
        const hasSelection = Boolean(selection)
        items.push(
          {
            id: "cut",
            label: "剪切",
            disabled: !hasSelection,
            action: () => {
              if (!hasSelection) return
              navigator.clipboard.writeText(selection).catch(() => {})
              // 从可编辑元素中移除
              document.execCommand("cut")
            },
          },
          {
            id: "copy",
            label: "复制",
            disabled: !hasSelection,
            action: () => {
              navigator.clipboard.writeText(selection).catch(() => {})
            },
          },
          {
            id: "paste",
            label: "粘贴",
            action: async () => {
              const text = await readClipboardSafe()
              if (!text) return
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                const start = el.selectionStart ?? el.value.length
                const end = el.selectionEnd ?? el.value.length
                el.setRangeText(text, start, end, "end")
                el.dispatchEvent(new Event("input", { bubbles: true }))
              } else {
                document.execCommand("insertText", false, text)
              }
            },
          },
          {
            id: "select-all",
            label: "全选",
            action: () => {
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.select()
              } else {
                const range = document.createRange()
                range.selectNodeContents(el)
                const sel = window.getSelection()
                sel?.removeAllRanges()
                sel?.addRange(range)
              }
            },
          },
        )
      } else if (selection) {
        items.push(
          {
            id: "copy",
            label: "复制",
            action: () => {
              navigator.clipboard.writeText(selection).catch(() => {})
            },
          },
          {
            id: "select-all",
            label: "全选",
            action: () => {
              const body = document.body
              const range = document.createRange()
              range.selectNodeContents(body)
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(range)
            },
          },
        )
      } else {
        items.push({
          id: "select-all",
          label: "全选",
          action: () => {
            const body = document.body
            const range = document.createRange()
            range.selectNodeContents(body)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          },
        })
      }

      if (anchor && anchor.href) {
        items.unshift(
          {
            id: "open-link",
            label: "打开链接",
            action: () => {
              window.open(anchor.href, "_blank")
            },
          },
          {
            id: "copy-link",
            label: "复制链接地址",
            action: () => {
              navigator.clipboard.writeText(anchor.href).catch(() => {})
            },
          },
        )
      }

      setMenu({
        items,
        pos: { x: e.clientX, y: e.clientY },
      })
    }

    function onAnyClick(e: MouseEvent) {
      if (!menu) return
      // 菜单自身的点击不关闭（由条目的 action 关闭）
      const node = e.target as HTMLElement
      if (node.closest("[data-app-context-menu]")) return
      closeRef.current()
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current()
    }

    document.addEventListener("contextmenu", onContextMenu)
    document.addEventListener("mousedown", onAnyClick)
    document.addEventListener("keydown", onKey)
    window.addEventListener("blur", closeRef.current)
    return () => {
      document.removeEventListener("contextmenu", onContextMenu)
      document.removeEventListener("mousedown", onAnyClick)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("blur", closeRef.current)
    }
  }, [menu])

  if (!menu) return null

  const { items, pos } = menu
  // 简单防越界（不考虑屏幕分辨率变化）：把菜单向屏幕内收一点
  const MAX_W = 180
  const MAX_H = items.length * 34 + 12
  const left = Math.min(pos.x, window.innerWidth - MAX_W - 8)
  const top = Math.min(pos.y, window.innerHeight - MAX_H - 8)

  return (
    <div
      data-app-context-menu
      className="fixed z-[200] min-w-[160px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.action()
            closeRef.current()
          }}
          className={`flex w-full items-center rounded px-3 py-1.5 text-left text-xs transition-colors ${
            item.disabled
              ? "cursor-not-allowed text-muted-foreground/60"
              : "hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
