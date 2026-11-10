import { useMemo, useState } from "react"
import { MAX_FILE_BYTES, SHARE_PASSWORD_MIN, createTransferSchema } from "@transfile/shared"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import { toast } from "sonner"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { HeroCollage } from "@/components/landing/hero-collage"
import { AppIcon } from "@/components/icons"
import { LiveCountdown } from "@/components/product/expiry-chip"
import { useGuestToken } from "@/lib/guest-token"
import { QrTile } from "@/components/product/qr-tile"
import { copyText } from "@/lib/clipboard"
import { ShareFields } from "@/components/product/share-fields"
import { emptyShareDraft, shareBody, type ShareDraft } from "@/lib/share-draft"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Surface } from "@/components/ui/surface"
import { Textarea } from "@/components/ui/textarea"
import { useUpload } from "@/features/upload/context"
import { useSession } from "@/lib/auth-client"
import { friendlyError } from "@/lib/errors"
import { ensureSession } from "@/lib/guest"
import { formatBytes } from "@/lib/format"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { shareCreatedSchema, transferCreatedSchema, usageSchema } from "@/lib/schemas"
import { isMember } from "@/lib/session"

type Phase = "editing" | "working" | "done"

export default function SendPage() {
  const session = useSession()
  const member = isMember(session.data?.user)
  const getToken = useGuestToken()
  const queryClient = useQueryClient()
  const upload = useUpload()
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState("")
  const [draft, setDraft] = useState<ShareDraft>(emptyShareDraft)
  const [phase, setPhase] = useState<Phase>("editing")
  const [transferId, setTransferId] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dropzone = useDropzone({
    noClick: true,
    onDrop(accepted) {
      setFiles((current) => [...current, ...accepted])
    },
  })

  const total = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])

  function reset() {
    setFiles([])
    setTitle("")
    setDraft(emptyShareDraft)
    setPhase("editing")
    setTransferId(null)
    setLink(null)
    setExpiresAt(null)
    setError(null)
  }

  async function getLink() {
    setError(null)
    if (files.length === 0) {
      setError("Add a file first")
      return
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("Each file must be 100 MB or smaller")
      return
    }
    if (files.some((file) => file.size < 1)) {
      setError("This file is empty")
      return
    }
    if (draft.passwordOn && draft.password.length < SHARE_PASSWORD_MIN) {
      setError("Use at least 6 characters")
      return
    }
    setPhase("working")
    try {
      await ensureSession(getToken)
      const usage = await queryClient.fetchQuery({
        queryKey: keys.usage,
        queryFn: () => readJson("/api/usage", usageSchema, "Could not check storage"),
      })
      if (!transferId && usage.used + total > usage.quota) {
        setError("This account is out of space.")
        setPhase("editing")
        return
      }
      let folderId = transferId
      if (!folderId) {
        const parsed = createTransferSchema.safeParse(title.trim() ? { title: title.trim() } : {})
        if (!parsed.success) {
          setError("Check the title")
          setPhase("editing")
          return
        }
        const transfer = await readJson("/api/transfers", transferCreatedSchema, "Could not start the transfer", {
          method: "POST",
          body: parsed.data,
        })
        await upload.enqueue(files, { folderId: transfer.id, expiresInHours: draft.expiresInHours })
        folderId = transfer.id
        setTransferId(folderId)
      }
      const created = await readJson("/api/shares", shareCreatedSchema, "Could not create the link", {
        method: "POST",
        body: {
          folderId,
          ...shareBody({ ...draft, allowComments: member && draft.allowComments }, member),
        },
      })
      setLink(created.url)
      setExpiresAt(created.share.expiresAt)
      setPhase("done")
    } catch (caught) {
      setError(friendlyError(caught, "Could not create the link"))
      setPhase(transferId ? "working" : "editing")
    }
  }

  return (
    <div className="grid gap-16">
      {!member ? (
        <Surface radius="card" padding={16} className="bg-lemon">
          <p className="text-sm text-ink">
            Without an account you cannot track downloads or receive comments.{" "}
            <Link to="/signup" className="font-bold text-brand">
              Sign up
            </Link>
          </p>
        </Surface>
      ) : null}
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="order-1 lg:order-2">
          <h1 className="display-xl">Send it. Keep it private.</h1>
          <p className="mt-3 text-base text-muted-foreground">
            Up to 100 MB per file and per account. Links last at most 3 days.
          </p>
          <HeroCollage />
        </div>
        <Surface
          radius="card"
          padding={16}
          className="order-2 bg-background shadow-soft lg:order-1"
          {...dropzone.getRootProps()}
        >
          <input {...dropzone.getInputProps()} aria-label="Add files" />
          {phase === "done" && link ? (
            <div className="grid gap-4">
              <h2 className="display-md">Your link is ready</h2>
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Share link" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void copyText(link).then(() => toast.success("Link copied"))
                  }}
                >
                  Copy
                </Button>
              </div>
              <QrTile value={link} />
              {expiresAt ? (
                <p className="text-sm text-muted-foreground">
                  <LiveCountdown expiresAt={expiresAt} />
                </p>
              ) : null}
              <Button type="button" variant="secondary" onClick={reset}>
                Send another
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="soft" onClick={dropzone.open}>
                  <AppIcon name="plus" size={18} />
                  Add files
                </Button>
              </div>
              {files.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Drop files here. 100 MB each.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-inset bg-surface p-2">
                      <FileTypeTile name={file.name} mime={file.type} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                      >
                        <AppIcon name="close" size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{formatBytes(total)} selected</p>
              <Field label="Title" htmlFor="transfer-title">
                <Input
                  id="transfer-title"
                  value={title}
                  placeholder="Optional"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="Message" htmlFor="transfer-message">
                <Textarea
                  id="transfer-message"
                  value={draft.message}
                  placeholder="Optional"
                  maxLength={500}
                  onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                />
              </Field>
              <ShareFields
                draft={draft}
                onChange={setDraft}
                member={member}
                idPrefix="send"
                showMessage={false}
              />
              {phase === "working" ? (
                <div className="grid gap-2" aria-live="polite">
                  <Progress value={upload.progress} aria-label="Upload progress" />
                  <p className="text-sm text-muted-foreground">
                    {transferId ? "Creating the link" : `Uploading ${upload.progress}%`}
                  </p>
                </div>
              ) : null}
              {error ? <p className="text-sm text-coral" role="alert">{error}</p> : null}
              <Button type="button" loading={phase === "working"} onClick={() => void getLink()}>
                {transferId ? "Try the link again" : "Get link"}
              </Button>
            </div>
          )}
        </Surface>
      </div>
      {!member ? <Landing /> : null}
    </div>
  )
}

function Landing() {
  const features = [
    {
      title: "Private by default",
      body: "Add a password and an expiry. Links last at most 72 hours.",
      className: "bg-blush",
    },
    {
      title: "Know when it lands",
      body: "Members get a notification when someone opens or downloads a file.",
      className: "bg-mint",
    },
    {
      title: "Leave a note",
      body: "Visitors can leave a comment that only you can read.",
      className: "bg-lemon",
    },
  ]
  return (
    <div className="grid gap-16">
      <section id="features" className="grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <Surface key={feature.title} radius="card" padding={20} className={feature.className}>
            <h2 className="display-md">{feature.title}</h2>
            <p className="mt-3 text-sm text-ink">{feature.body}</p>
          </Surface>
        ))}
      </section>
      <section id="how" className="grid gap-4 md:grid-cols-3">
        {["Add your files", "Choose who can open them", "Share the link"].map((step, index) => (
          <Surface key={step} radius="card" padding={20} className="bg-background">
            <p className="text-sm font-bold text-brand">{index + 1}</p>
            <h2 className="display-md mt-2">{step}</h2>
          </Surface>
        ))}
      </section>
      <section id="security">
        <Surface radius="card" padding={24} className="bg-brand text-brand-foreground">
          <h2 className="display-lg">Send a private link</h2>
          <p className="mt-2 text-sm">100 MB per file. Links expire within 3 days.</p>
          <Button type="button" variant="dark" className="mt-4" asChild>
            <a href="#transfer-title">Get a link</a>
          </Button>
        </Surface>
      </section>
    </div>
  )
}
