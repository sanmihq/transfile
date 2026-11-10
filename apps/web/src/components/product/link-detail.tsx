import { useState } from "react"
import { SHARE_PASSWORD_MIN } from "@transfile/shared"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ConfirmDialog, ModalFrame } from "@/components/product/confirm-dialog"
import { LiveCountdown } from "@/components/product/expiry-chip"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { ShareFields } from "@/components/product/share-fields"
import type { ShareDraft } from "@/lib/share-draft"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  markCommentsRead,
  useActivity,
  useComments,
  useRevokeShare,
  useShares,
  useUpdateShare,
} from "@/hooks/use-library"
import { apiDelete } from "@/lib/api"
import { friendlyError } from "@/lib/errors"
import { expiryChoices, maxExpiryHours } from "@/lib/expiry"
import { formatAgo, formatBytes } from "@/lib/format"
import { keys } from "@/lib/keys"
import type { ActivityItem, ShareRecord } from "@/lib/schemas"

const statusLabel: Record<ShareRecord["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  exhausted: "Used up",
}

const activityLabel: Record<ActivityItem["type"], string> = {
  opened: "Opened",
  unlocked: "Unlocked",
  unlock_failed: "Wrong password",
  downloaded: "Downloaded",
  commented: "Commented",
}

function draftFromShare(share: ShareRecord): ShareDraft {
  return {
    expiresInHours: Math.min(72, Math.max(1, maxExpiryHours(share.createdAt) || 1)),
    passwordOn: share.hasPassword,
    password: "",
    limit: share.maxDownloads === null ? "unlimited" : String(share.maxDownloads),
    allowComments: share.allowComments,
    message: share.message ?? "",
  }
}

export function LinkDetail({
  shareId,
  open,
  onOpenChange,
}: {
  shareId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const shares = useShares()
  const share = shares.data?.find((item) => item.id === shareId) ?? null
  const activity = useActivity(shareId ?? "", open && shareId !== null)
  const comments = useComments(shareId ?? "", open && shareId !== null)
  const update = useUpdateShare()
  const revoke = useRevokeShare()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ShareDraft | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [qr, setQr] = useState(false)

  const choices = share ? expiryChoices(maxExpiryHours(share.createdAt)) : []
  const allowed = share ? maxExpiryHours(share.createdAt) : 0

  async function save() {
    if (!share || !draft) return
    if (draft.passwordOn && draft.password.length > 0 && draft.password.length < SHARE_PASSWORD_MIN) {
      toast.error("Use at least 6 characters")
      return
    }
    const body: {
      expiresInHours?: number
      maxDownloads?: number | null
      password?: string | null
      allowComments?: boolean
      message?: string | null
    } = {
      expiresInHours: draft.expiresInHours,
      maxDownloads: draft.limit === "unlimited" ? null : Number(draft.limit),
      allowComments: draft.allowComments,
      message: draft.message.trim() ? draft.message.trim() : null,
    }
    if (!draft.passwordOn && share.hasPassword) body.password = null
    if (draft.passwordOn && draft.password.length >= SHARE_PASSWORD_MIN) body.password = draft.password
    try {
      await update.mutateAsync({ id: share.id, body })
      setEditing(false)
      toast.success("Link updated")
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  async function markRead(id: string) {
    await markCommentsRead([id])
    await queryClient.invalidateQueries({ queryKey: keys.comments(share?.id ?? "") })
    await queryClient.invalidateQueries({ queryKey: keys.shares })
  }

  async function removeComment(id: string) {
    await apiDelete(`/api/comments/${encodeURIComponent(id)}`)
    await queryClient.invalidateQueries({ queryKey: keys.comments(share?.id ?? "") })
    await queryClient.invalidateQueries({ queryKey: keys.shares })
  }

  return (
    <>
      <ModalFrame
        open={open}
        onOpenChange={onOpenChange}
        title={share?.targetName ?? "Link"}
        description={share ? statusLabel[share.status] : undefined}
      >
        {!share ? <p className="text-sm text-muted-foreground">This link is not in your list.</p> : null}
        {share ? (
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="grid gap-3 pt-3">
              <p className="text-sm text-muted-foreground">
                {share.kind} · {share.fileCount} files · {formatBytes(share.totalSize)}
              </p>
              <p className="text-sm"><LiveCountdown expiresAt={share.expiresAt} /></p>
              <p className="text-sm text-muted-foreground">
                Downloads {share.downloadCount}/{share.maxDownloads ?? "unlimited"}
              </p>
              {share.message ? <p className="text-sm">{share.message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void copyText(share.url).then(() => toast.success("Link copied"))
                  }}
                >
                  Copy link
                </Button>
                <Button type="button" variant="secondary" onClick={() => setQr((value) => !value)}>
                  QR
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDraft(draftFromShare(share))
                    setEditing(true)
                  }}
                >
                  Edit
                </Button>
                <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>
                  Revoke
                </Button>
              </div>
              {qr ? <QrTile value={share.url} /> : null}
              {editing && draft ? (
                <div className="grid gap-3">
                  <p className="text-xs text-muted-foreground">
                    Longest allowed expiry is {allowed}h.
                  </p>
                  <ShareFields
                    draft={draft}
                    onChange={setDraft}
                    member
                    choices={choices.length > 0 ? choices : [1]}
                    idPrefix="edit-share"
                  />
                  <Button type="button" loading={update.isPending} onClick={() => void save()}>
                    Save
                  </Button>
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="activity" className="pt-3">
              {activity.isPending ? <p className="text-sm text-muted-foreground">Loading</p> : null}
              {activity.isError ? (
                <Button type="button" variant="secondary" onClick={() => void activity.refetch()}>
                  Try again
                </Button>
              ) : null}
              {activity.data && activity.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet</p>
              ) : null}
              <ul className="grid gap-2">
                {activity.data?.items.map((item) => (
                  <li key={item.id} className="rounded-inset bg-surface px-3 py-2 text-sm">
                    <p className="font-bold text-ink">{activityLabel[item.type]}</p>
                    <p className="text-muted-foreground">
                      {item.fileId ? "A file" : "The link"}
                      {item.country ? ` · ${item.country}` : ""} · {formatAgo(item.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="comments" className="pt-3">
              {comments.isPending ? <p className="text-sm text-muted-foreground">Loading</p> : null}
              {comments.isError ? (
                <Button type="button" variant="secondary" onClick={() => void comments.refetch()}>
                  Try again
                </Button>
              ) : null}
              {comments.data && comments.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              ) : null}
              <ul className="grid gap-2">
                {comments.data?.items.map((item) => (
                  <li key={item.id} className="rounded-inset bg-surface px-3 py-2 text-sm">
                    <p className="font-bold text-ink">{item.authorName ?? "Anonymous"}</p>
                    <p>{item.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.fileName ? `${item.fileName} · ` : ""}
                      {formatAgo(item.createdAt)}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {item.readAt ? null : (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void markRead(item.id)}>
                          Mark read
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" onClick={() => void removeComment(item.id)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        ) : null}
      </ModalFrame>
      <ConfirmDialog
        open={confirm}
        title="Revoke this link?"
        body="People with the link will no longer be able to open it."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onOpenChange={setConfirm}
        onConfirm={() => {
          if (!share) return
          void revoke.mutateAsync(share.id).then(() => {
            setConfirm(false)
            onOpenChange(false)
          })
        }}
      />
    </>
  )
}
