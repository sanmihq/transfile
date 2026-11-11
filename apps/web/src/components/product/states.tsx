import type { ReactNode } from "react"
import { AppIcon, type AppIconName } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ListSkeleton } from "@/components/layout/skeletons"

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <ListSkeleton />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: AppIconName
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="grid justify-items-center gap-3 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-inset bg-surface text-brand">
        <AppIcon name={icon} />
      </span>
      <div className="grid max-w-sm gap-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
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
