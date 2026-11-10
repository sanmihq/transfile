import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal"

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{body}</ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <ResponsiveModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

export function ModalFrame({
  open,
  title,
  description,
  onOpenChange,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
          {description ? <ResponsiveModalDescription>{description}</ResponsiveModalDescription> : null}
        </ResponsiveModalHeader>
        {children}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
