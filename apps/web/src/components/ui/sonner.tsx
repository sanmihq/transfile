import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { AppIcon } from "@/components/icons"

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <AppIcon name="check" size={16} />,
        info: <AppIcon name="help" size={16} />,
        warning: <AppIcon name="alert" size={16} />,
        error: <AppIcon name="alert" size={16} />,
        loading: <AppIcon name="clock" size={16} className="animate-spin" />,
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
            "rounded-card border-0 bg-background text-foreground shadow-soft",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
