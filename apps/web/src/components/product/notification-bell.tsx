import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { AppIcon, type AppIconName } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { CountBubble } from "@/components/ui/count-bubble"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { markNotificationsRead, useUnreadCount } from "@/hooks/use-library"
import { friendlyError } from "@/lib/errors"
import { formatAgo } from "@/lib/format"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { notificationListSchema, type NotificationRecord } from "@/lib/schemas"

const iconFor: Record<NotificationRecord["type"], AppIconName> = {
  share_opened: "eye",
  file_downloaded: "download",
  share_locked: "lock",
  comment_received: "comment",
  share_expiring: "clock",
  share_expired: "clock",
  files_expired: "alert",
}

export function NotificationBell() {
  const queryClient = useQueryClient()
  const unread = useUnreadCount(true)
  const [open, setOpen] = useState(false)
  const seen = useRef<number | null>(null)
  const count = unread.data?.count ?? 0

  const latest = useQuery({
    queryKey: [...keys.notifications, "latest"] as const,
    enabled: open,
    queryFn: () => readJson("/api/notifications?limit=8", notificationListSchema, "Could not load notifications"),
  })

  const refreshUnread = unread.refetch
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshUnread()
    }
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [refreshUnread])

  useEffect(() => {
    if (unread.data === undefined) return
    const next = unread.data.count
    if (seen.current === null) {
      seen.current = next
      return
    }
    if (next > seen.current) {
      void readJson("/api/notifications?limit=1", notificationListSchema, "Could not load notifications")
        .then((page) => {
          const title = page.items[0]?.title
          if (title) toast(title)
        })
        .catch(() => undefined)
    }
    seen.current = next
  }, [unread.data])

  async function markAll() {
    try {
      await markNotificationsRead()
      await queryClient.invalidateQueries({ queryKey: keys.notifications })
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <span className="relative">
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="secondary" aria-label="Notifications">
            <AppIcon name="bell" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <CountBubble count={count} cap={9} />
      </span>
      <span className="sr-only" aria-live="polite">
        {count === 1 ? "1 unread notification" : `${count} unread notifications`}
      </span>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-sm font-bold text-ink">Notifications</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()}>
            Mark all read
          </Button>
        </div>
        {latest.isPending ? <p className="px-2 py-3 text-sm text-muted-foreground">Loading</p> : null}
        {latest.isError ? (
          <Button type="button" variant="secondary" onClick={() => void latest.refetch()}>
            Try again
          </Button>
        ) : null}
        {latest.data && latest.data.items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Nothing new</p>
        ) : null}
        <ul className="grid gap-1">
          {latest.data?.items.map((item) => (
            <li key={item.id} className="flex gap-2 rounded-inset px-2 py-2">
              <AppIcon name={iconFor[item.type]} size={18} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{item.title}</p>
                <p className="text-xs text-muted-foreground">{formatAgo(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" className="mt-2 w-full" asChild>
          <Link to="/inbox" onClick={() => setOpen(false)}>
            View all
          </Link>
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
