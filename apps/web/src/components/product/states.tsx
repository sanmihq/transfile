import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid gap-3" role="status" aria-label={label}>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-2/3" />
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="grid gap-2 py-8 text-center">
      <p className="text-lg font-bold text-ink">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="grid gap-3 py-6" role="alert">
      <p className="text-sm text-foreground">{message}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
