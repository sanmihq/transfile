import type { ReactNode } from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { useMediaQuery } from "@/hooks/use-media-query"

const desktopQuery = "(min-width: 768px)"

function ResponsiveModal({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    )
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {children}
    </Drawer>
  )
}

function ResponsiveModalTrigger({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogTrigger className={className}>{children}</DialogTrigger>
  }
  return <DrawerTrigger className={className}>{children}</DrawerTrigger>
}

function ResponsiveModalContent({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogContent className={className}>{children}</DialogContent>
  }
  return <DrawerContent className={className}>{children}</DrawerContent>
}

function ResponsiveModalHeader({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogHeader className={className}>{children}</DialogHeader>
  }
  return <DrawerHeader className={className}>{children}</DrawerHeader>
}

function ResponsiveModalTitle({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogTitle className={className}>{children}</DialogTitle>
  }
  return <DrawerTitle className={className}>{children}</DrawerTitle>
}

function ResponsiveModalDescription({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return (
      <DialogDescription className={className}>{children}</DialogDescription>
    )
  }
  return (
    <DrawerDescription className={className}>{children}</DrawerDescription>
  )
}

function ResponsiveModalFooter({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogFooter className={className}>{children}</DialogFooter>
  }
  return <DrawerFooter className={className}>{children}</DrawerFooter>
}

function ResponsiveModalClose({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const desktop = useMediaQuery(desktopQuery)
  if (desktop) {
    return <DialogClose className={className}>{children}</DialogClose>
  }
  return <DrawerClose className={className}>{children}</DrawerClose>
}

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalClose,
}
