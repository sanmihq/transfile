import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { AppIcon } from "@/components/icons"

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group font-sans"
      icons={{
        success: <AppIcon name="check" />,
        info: <AppIcon name="help" />,
        warning: <AppIcon name="alert" />,
        error: <AppIcon name="alert" />,
        loading: <AppIcon name="clock" className="animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--background)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--r-card)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "rounded-card border-0 bg-background font-sans text-foreground shadow-soft",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
