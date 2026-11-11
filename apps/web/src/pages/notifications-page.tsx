import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AppIcon, type AppIconName } from "@/components/icons"
import { LinkDetail } from "@/components/product/link-detail"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import { markNotificationsRead, useNotifications } from "@/hooks/use-library"
import { friendlyError } from "@/lib/errors"
import { formatAgo } from "@/lib/format"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { notificationListSchema, type NotificationRecord } from "@/lib/schemas"
import { cn } from "@/lib/utils"

const iconFor: Record<NotificationRecord["type"], AppIconName> = {
  share_opened: "eye",
  file_downloaded: "download",
  share_locked: "lock",
  comment_received: "comment",
  share_expiring: "clockFading",
  share_expired: "clockFading",
  files_expired: "alert",
}

const labelFor: Record<NotificationRecord["type"], string> = {
  share_opened: "Opened",
  file_downloaded: "Download",
  share_locked: "Locked",
  comment_received: "Comment",
  share_expiring: "Expiring",
  share_expired: "Expired",
  files_expired: "Files expired",
}

const compact = "h-9 px-3 text-[13px] font-medium"

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const notes = useNotifications()
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [older, setOlder] = useState<NotificationRecord[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)

  const items = [...(notes.data?.items ?? []), ...older]
  const visible = filter === "unread" ? items.filter((item) => item.readAt === null) : items

  async function markAll() {
    try {
      await markNotificationsRead()
      await queryClient.invalidateQueries({ queryKey: keys.notifications })
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  async function loadMore() {
    const oldest = items[items.length - 1]?.createdAt
    if (!oldest) return
    setLoadingMore(true)
    try {
      const next = await readJson(
        `/api/notifications?limit=20&before=${encodeURIComponent(oldest)}`,
        notificationListSchema,
        "Could not load notifications",
      )
      setOlder((current) => [...current, ...next.items])
    } catch (error) {
      toast.error(friendlyError(error))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display-lg">Notifications</h1>
        <Button type="button" variant="secondary" className={compact} onClick={() => void markAll()}>
          Mark all read
        </Button>
      </div>
      <div className="flex gap-2" role="group" aria-label="Filter notifications">
        {(["all", "unread"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={filter === value ? "dark" : "secondary"}
            className={compact}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : "Unread"}
          </Button>
        ))}
      </div>
      {notes.isPending ? <LoadingBlock label="Loading notifications" /> : null}
      {notes.isError ? (
        <ErrorState message="Could not load notifications" onRetry={() => void notes.refetch()} />
      ) : null}
      {!notes.isPending && !notes.isError && visible.length === 0 ? (
        <EmptyState icon="bell" title="Nothing new" body="Opens, downloads, and link updates will show up here." />
      ) : null}
      <ul className="grid">
        {visible.map((item) => (
          <li key={item.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center gap-3 py-3 text-left"
              onClick={() => {
                if (item.shareId) setShareId(item.shareId)
              }}
            >
              <span className={cn("flex size-10 items-center justify-center rounded-inset bg-background text-ink", item.readAt === null && "text-brand")}>
                <AppIcon name={iconFor[item.type]} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{labelFor[item.type]}</span>
                <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                {item.body ? <span className="block truncate text-sm text-muted-foreground">{item.body}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatAgo(item.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 ? (
        <Button type="button" variant="secondary" className={compact} loading={loadingMore} onClick={() => void loadMore()}>
          Load older
        </Button>
      ) : null}
      <LinkDetail shareId={shareId} open={shareId !== null} onOpenChange={(open) => !open && setShareId(null)} />
    </div>
  )
}
