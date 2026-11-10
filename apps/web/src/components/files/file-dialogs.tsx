import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal"
import type { OwnedFile } from "@/lib/models"

export function RenameFileDialog({
  file,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  file: OwnedFile | null
  pending: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <ResponsiveModal open={file !== null} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <RenameForm
          key={file?.id ?? "closed"}
          file={file}
          pending={pending}
          error={error}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function RenameForm({
  file,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  file: OwnedFile | null
  pending: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(file?.name ?? "")

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(name)
      }}
    >
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>Rename file</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          This changes the name in your library.
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <div className="mt-4">
        <Field label="Name" htmlFor="file-name" error={error || undefined}>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
      <ResponsiveModalFooter className="mt-6">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          Save
        </Button>
      </ResponsiveModalFooter>
    </form>
  )
}

export function DeleteFileDialog({
  file,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  file: OwnedFile | null
  pending: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <ResponsiveModal open={file !== null} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Delete file</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {file
              ? `${file.name} will be removed from your library.`
              : "This file will be removed from your library."}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <ResponsiveModalFooter className="mt-6">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
