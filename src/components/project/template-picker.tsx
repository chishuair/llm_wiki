import { templates } from "@/lib/templates"
import { cn } from "@/lib/utils"

interface TemplatePickerProps {
  selected: string
  onSelect: (id: string) => void
}

export function TemplatePicker({ selected, onSelect }: TemplatePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {templates.map((template) => {
        const isActive = selected === template.id
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template.id)}
            className={cn(
              "flex flex-col gap-1 rounded-md border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent/40",
              isActive
                ? "border-primary bg-primary/10 ring-1 ring-primary"
                : "border-border bg-background",
            )}
          >
            <span className="text-xl leading-none">{template.icon}</span>
            <span className="text-sm font-semibold leading-tight">{template.name}</span>
            <span className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
              {template.description}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground/80">
              {template.dirs.length} 个目录
            </span>
          </button>
        )
      })}
    </div>
  )
}
