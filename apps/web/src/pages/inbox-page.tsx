import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AppIcon, type AppIconName } from "@/components/icons"
import { LinkDetail } from "@/components/product/link-detail"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import { markCommentsRead, markNotificationsRead, useCommentFeed, useNotifications } from "@/hooks/use-library"
import { friendlyError } from "@/lib/errors"
import { formatAgo } from "@/lib/format"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import {
  commentListSchema,
  notificationListSchema,
  type CommentRecord,
  type NotificationRecord,
} from "@/lib/schemas"
import { cn } from "@/lib/utils"

type Filter = "all" | "comments" | "activity"

const kindLabel: Record<NotificationRecord["type"], string> = {
  share_opened: "Opened",
  file_downloaded: "Download",
  share_locked: "Locked",
  comment_received: "Comment",
  share_expiring: "Expiring",
  share_expired: "Expired",
  files_expired: "Files expired",
}

const compact = "h-9 px-3 text-[13px] font-medium"

type FeedItem =
  | { kind: "notification"; id: string; createdAt: string; unread: boolean; shareId: string | null; title: string; body: string | null; type: NotificationRecord["type"] }
  | { kind: "comment"; id: string; createdAt: string; unread: boolean; shareId: string; title: string; body: string }

const iconFor: Record<NotificationRecord["type"], AppIconName> = {
  share_opened: "eye",
  file_downloaded: "download",
  share_locked: "lock",
  comment_received: "comment",
  share_expiring: "clockFading",
  share_expired: "clockFading",
  files_expired: "alert",
}

export default function InboxPage() {
  const queryClient = useQueryClient()
  const notes = useNotifications()
  const comments = useCommentFeed()
  const [filter, setFilter] = useState<Filter>("all")
  const [olderNotes, setOlderNotes] = useState<NotificationRecord[]>([])
  const [olderComments, setOlderComments] = useState<CommentRecord[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)

  const noteItems = [...(notes.data?.items ?? []), ...olderNotes]
  const commentItems = [...(comments.data?.items ?? []), ...olderComments]
  const feed: FeedItem[] = [
    ...noteItems.map((item) => ({
      kind: "notification" as const,
      id: item.id,
      createdAt: item.createdAt,
      unread: item.readAt === null,
      shareId: item.shareId,
      title: item.title,
      body: item.body,
      type: item.type,
    })),
    ...commentItems.map((item) => ({
      kind: "comment" as const,
      id: item.id,
      createdAt: item.createdAt,
      unread: item.readAt === null,
      shareId: item.shareId,
      title: item.shareTitle,
      body: item.body,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  const visible = feed.filter((item) => {
    if (filter === "comments") return item.kind === "comment"
    if (filter === "activity") return item.kind === "notification"
    return true
  })

  async function markAll() {
    try {
      await markNotificationsRead()
      await markCommentsRead()
      await queryClient.invalidateQueries({ queryKey: keys.notifications })
      await queryClient.invalidateQueries({ queryKey: keys.commentFeed })
      await queryClient.invalidateQueries({ queryKey: keys.shares })
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  async function loadMore() {
    const oldest = visible[visible.length - 1]?.createdAt
    if (!oldest) return
    setLoadingMore(true)
    try {
      const [nextNotes, nextComments] = await Promise.all([
        readJson(
          `/api/notifications?limit=20&before=${encodeURIComponent(oldest)}`,
          notificationListSchema,
          "Could not load notifications",
        ),
        readJson(
          `/api/comments?limit=20&before=${encodeURIComponent(oldest)}`,
          commentListSchema,
          "Could not load comments",
        ),
      ])
      setOlderNotes((current) => [...current, ...nextNotes.items])
      setOlderComments((current) => [...current, ...nextComments.items])
    } catch (error) {
      toast.error(friendlyError(error))
    } finally {
      setLoadingMore(false)
    }
  }

  const pending = notes.isPending || comments.isPending
  const failed = notes.isError || comments.isError

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="display-lg">Inbox</h1>
        <Button type="button" variant="secondary" className={compact} onClick={() => void markAll()}>
          Mark all read
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter inbox">
        {(
          [
            ["all", "All"],
            ["comments", "Comments"],
            ["activity", "Activity"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={filter === value ? "dark" : "secondary"}
            className={compact}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {pending ? <LoadingBlock label="Loading inbox" /> : null}
      {failed ? (
        <ErrorState
          message="Could not load the inbox"
          onRetry={() => {
            void notes.refetch()
            void comments.refetch()
          }}
        />
      ) : null}
      {!pending && !failed && visible.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing here yet" body="Downloads, comments, and link activity will show up here." />
      ) : null}
      <ul className="grid">
        {visible.map((item) => (
          <li key={`${item.kind}-${item.id}`} className="border-b border-border last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center gap-3 py-3 text-left"
              onClick={() => {
                if (item.shareId) setShareId(item.shareId)
              }}
            >
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-inset bg-background", item.unread ? "text-brand" : "text-ink")}>
                <AppIcon name={item.kind === "notification" ? iconFor[item.type] : "comment"} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">
                  {item.kind === "comment" ? "Comment" : kindLabel[item.type]}
                </span>
                <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                {item.body ? <span className="block truncate text-sm text-muted-foreground">{item.body}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatAgo(item.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {visible.length > 0 ? (
        <Button type="button" variant="secondary" className={compact} loading={loadingMore} onClick={() => void loadMore()}>
          Load older
        </Button>
      ) : null}
      <LinkDetail shareId={shareId} open={shareId !== null} onOpenChange={(open) => !open && setShareId(null)} />
    </div>
  )
}
