import { useState } from "react"
import { toast } from "sonner"
import { AppIcon } from "@/components/icons"
import { ConfirmDialog } from "@/components/product/confirm-dialog"
import { ExpiryChip } from "@/components/product/expiry-chip"
import { LinkDetail } from "@/components/product/link-detail"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import { CountBubble } from "@/components/ui/count-bubble"
import { Surface } from "@/components/ui/surface"
import { useRevokeShare, useShares } from "@/hooks/use-library"
import { formatBytes } from "@/lib/format"
import type { ShareRecord } from "@/lib/schemas"

const statusLabel: Record<ShareRecord["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  exhausted: "Used up",
}

export default function SharedLinksPage() {
  const shares = useShares()
  const revoke = useRevokeShare()
  const [openId, setOpenId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)

  return (
    <div className="grid gap-4">
      <h1 className="display-lg">Links</h1>
      {shares.isPending ? <LoadingBlock label="Loading links" /> : null}
      {shares.isError ? <ErrorState message="Could not load links" onRetry={() => void shares.refetch()} /> : null}
      {shares.data && shares.data.length === 0 ? (
        <EmptyState title="No links yet" body="Share a file or send a transfer to see it here." />
      ) : null}
      <ul className="grid gap-3">
        {shares.data?.map((share) => (
          <li key={share.id}>
            <Surface radius="card" padding={16} className="bg-background">
              <button type="button" className="w-full text-left" onClick={() => setOpenId(share.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink">{share.targetName}</p>
                    <p className="text-sm text-muted-foreground">
                      {share.kind} · {share.fileCount} files · {formatBytes(share.totalSize)}
                    </p>
                  </div>
                  <span className="relative">
                    <span className="rounded-inset bg-surface px-2 py-1 text-xs font-bold">
                      {statusLabel[share.status]}
                    </span>
                    {share.unreadComments > 0 ? <CountBubble count={share.unreadComments} /> : null}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <ExpiryChip expiresAt={share.expiresAt} />
                  <span>
                    {share.downloadCount}/{share.maxDownloads ?? "unlimited"} downloads
                  </span>
                </div>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void copyText(share.url).then(() => toast.success("Link copied"))
                  }}
                >
                  Copy link
                </Button>
                <Button type="button" size="sm" variant="secondary" aria-label="Show QR code" onClick={() => setQr(share.url)}>
                  <AppIcon name="qr" size={16} />
                  QR
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setOpenId(share.id)}>
                  Edit
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => setRevokeId(share.id)}>
                  Revoke
                </Button>
              </div>
              {qr === share.url ? (
                <div className="mt-3">
                  <QrTile value={share.url} />
                </div>
              ) : null}
            </Surface>
          </li>
        ))}
      </ul>
      <LinkDetail shareId={openId} open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)} />
      <ConfirmDialog
        open={revokeId !== null}
        title="Revoke this link?"
        body="People with the link will no longer be able to open it."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onOpenChange={(open) => !open && setRevokeId(null)}
        onConfirm={() => {
          if (!revokeId) return
          void revoke.mutateAsync(revokeId).then(() => setRevokeId(null))
        }}
      />
    </div>
  )
}
