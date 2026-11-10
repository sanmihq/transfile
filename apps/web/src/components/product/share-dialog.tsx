import { useState } from "react"
import { SHARE_PASSWORD_MIN } from "@transfile/shared"
import { toast } from "sonner"
import { LiveCountdown } from "@/components/product/expiry-chip"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { ShareFields } from "@/components/product/share-fields"
import { emptyShareDraft, shareBody, type ShareDraft } from "@/lib/share-draft"
import { ModalFrame } from "@/components/product/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCreateShare } from "@/hooks/use-library"
import { friendlyError } from "@/lib/errors"

export function ShareDialog({
  open,
  title,
  fileId,
  folderId,
  onOpenChange,
}: {
  open: boolean
  title: string
  fileId?: string
  folderId?: string
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateShare()
  const [draft, setDraft] = useState<ShareDraft>(emptyShareDraft)
  const [url, setUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  function close(next: boolean) {
    if (!next) {
      setDraft(emptyShareDraft)
      setUrl(null)
      setExpiresAt(null)
    }
    onOpenChange(next)
  }

  async function submit() {
    if (draft.passwordOn && draft.password.length < SHARE_PASSWORD_MIN) {
      toast.error("Use at least 6 characters")
      return
    }
    try {
      const created = await create.mutateAsync({
        ...(fileId ? { fileId } : {}),
        ...(folderId ? { folderId } : {}),
        ...shareBody(draft, true),
      })
      setUrl(created.url)
      setExpiresAt(created.share.expiresAt)
    } catch (error) {
      toast.error(friendlyError(error, "Could not create the link"))
    }
  }

  return (
    <ModalFrame open={open} onOpenChange={close} title={url ? "Link ready" : `Share ${title}`}>
      {url ? (
        <div className="grid gap-4">
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label="Share link" />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void copyText(url).then(() => toast.success("Link copied"))
              }}
            >
              Copy
            </Button>
          </div>
          <QrTile value={url} />
          {expiresAt ? <p className="text-sm text-muted-foreground"><LiveCountdown expiresAt={expiresAt} /></p> : null}
        </div>
      ) : (
        <div className="grid gap-4">
          <ShareFields draft={draft} onChange={setDraft} member idPrefix="share" />
          <Button type="button" loading={create.isPending} onClick={() => void submit()}>
            Create link
          </Button>
        </div>
      )}
    </ModalFrame>
  )
}
