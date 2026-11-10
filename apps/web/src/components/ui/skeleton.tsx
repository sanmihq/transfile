import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-card bg-surface-strong", className)}
      {...props}
    />
  )
}

export { Skeleton }
