import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const amount = value ?? 0

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-floor bg-surface-strong",
        className,
      )}
      value={amount}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full bg-success transition-all"
        style={{ width: `${Math.min(100, Math.max(0, amount))}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
