import { useState } from "react"
import { toast } from "sonner"
import { AppIcon, type AppIconName } from "@/components/icons"
import { ConfirmDialog } from "@/components/product/confirm-dialog"
import { ExpiryChip } from "@/components/product/expiry-chip"
import { LinkDetail } from "@/components/product/link-detail"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/ui/surface"
import { useRevokeShare, useShares } from "@/hooks/use-library"
import { formatBytes } from "@/lib/format"
import type { ShareRecord } from "@/lib/schemas"

function AccessRow({ icon, title, detail }: { icon: AppIconName; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-inset bg-background text-ink">
        <AppIcon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  )
}

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
        <EmptyState icon="links" title="No links yet" body="Share a file or send a transfer to see it here." />
      ) : null}
      <ul className="grid gap-3">
        {shares.data?.map((share) => (
          <li key={share.id}>
            <Surface radius="card" padding={16} className="group relative bg-background">
              <button type="button" className="w-full text-left" onClick={() => setOpenId(share.id)}>
                <p className="text-xs text-muted-foreground">General access</p>
                <AccessRow
                  icon={share.hasPassword ? "lock" : "link"}
                  title={share.hasPassword ? "Password required" : "Anyone with the link"}
                  detail={`${statusLabel[share.status]} · ${share.fileCount} files · ${formatBytes(share.totalSize)}`}
                />
                <div className="border-t border-border">
                  <AccessRow
                    icon="clockFading"
                    title={share.targetName}
                    detail={`${share.kind} · ${share.downloadCount}/${share.maxDownloads ?? "unlimited"} downloads`}
                  />
                </div>
              </button>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <ExpiryChip expiresAt={share.expiresAt} />
                {share.unreadComments > 0 ? (
                  <span className="text-xs">{share.unreadComments} new comments</span>
                ) : null}
              </div>
              {qr === share.url ? (
                <div className="mt-3">
                  <QrTile value={share.url} />
                </div>
              ) : null}
              <div className="-mx-4 -mb-4 mt-3 flex items-center gap-2 border-t border-border bg-surface px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{share.url}</p>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Show QR code"
                  onClick={() => setQr(qr === share.url ? null : share.url)}
                >
                  <AppIcon name="qr" />
                </Button>
                <Button type="button" variant="secondary" className="h-9 px-3 text-[13px] font-medium" onClick={() => {
                  void copyText(share.url).then(() => toast.success("Link copied"))
                }}>
                  <AppIcon name="link" />
                  Copy link
                </Button>
              </div>
              <button
                type="button"
                className="absolute top-4 right-3 flex items-center gap-2 rounded-inset bg-coral px-2 py-2 text-xs font-medium text-white opacity-0 transition-opacity outline-none group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => setRevokeId(share.id)}
              >
                <AppIcon name="close" />
                Revoke
              </button>
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
