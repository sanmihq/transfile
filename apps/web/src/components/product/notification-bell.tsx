import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { AppIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { CountBubble } from "@/components/ui/count-bubble"
import { useUnreadCount } from "@/hooks/use-library"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { notificationListSchema } from "@/lib/schemas"

export function NotificationBell() {
  const queryClient = useQueryClient()
  const unread = useUnreadCount(true)
  const seen = useRef<number | null>(null)
  const count = unread.data?.count ?? 0

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
      void queryClient.invalidateQueries({ queryKey: keys.notifications })
      void readJson("/api/notifications?limit=1", notificationListSchema, "Could not load notifications")
        .then((page) => {
          const title = page.items[0]?.title
          if (title) toast(title)
        })
        .catch(() => undefined)
    }
    seen.current = next
  }, [queryClient, unread.data])

  return (
    <span className="relative">
      <Button type="button" size="icon" variant="secondary" aria-label="Notifications" asChild>
        <Link to="/notifications">
          <AppIcon name="bell" />
        </Link>
      </Button>
      <CountBubble count={count} cap={9} />
      <span className="sr-only" aria-live="polite">
        {count === 1 ? "1 unread notification" : `${count} unread notifications`}
      </span>
    </span>
  )
}
