import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Concentric radii: a child's corner radius is this surface's radius minus the
 * padding between them, and never below --r-floor (6px).
 *
 * Surface sets its own border-radius and padding, then publishes --parent-r and
 * --parent-pad. Children use the `rounded-inset` utility, which reads those
 * variables. A nested Surface replaces the variables, so its children follow
 * the inner surface instead of the outer one.
 */
const radiusVar = {
  card: "var(--r-card)",
  sheet: "var(--r-sheet)",
  control: "var(--r-control)",
} as const

type SurfaceRadius = keyof typeof radiusVar | number

export function Surface({
  radius = "card",
  padding = 0,
  className,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  radius?: SurfaceRadius
  padding?: number
  children?: ReactNode
}) {
  const radiusValue = typeof radius === "number" ? `${radius}px` : radiusVar[radius]
  const pad = `${padding}px`

  return (
    <div
      {...props}
      className={cn(className)}
      style={{
        borderRadius: radiusValue,
        padding: pad,
        ["--parent-r" as string]: radiusValue,
        ["--parent-pad" as string]: pad,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
