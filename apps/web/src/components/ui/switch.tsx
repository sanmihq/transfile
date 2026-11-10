import { cn } from "@/lib/utils"

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  label: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-control [--parent-pad:3px] [--parent-r:var(--r-control)] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-brand" : "bg-surface-strong",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[3px] left-[3px] size-[22px] rounded-inset bg-background shadow-soft transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  )
}
