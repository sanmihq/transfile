import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-inset text-[15px] font-bold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:bg-brand-strong",
        brand: "bg-brand text-brand-foreground hover:bg-brand-strong",
        dark: "bg-ink text-white hover:brightness-95",
        soft: "bg-brand-tint text-brand hover:brightness-95",
        secondary: "bg-surface text-ink hover:bg-surface-strong",
        ghost: "bg-transparent text-ink hover:bg-surface",
        destructive: "bg-coral text-white hover:brightness-95",
        link: "h-auto! rounded-none px-0 font-bold text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-5",
        sm: "h-10 px-4",
        lg: "h-14 px-6",
        icon: "size-11 bg-surface text-ink hover:bg-surface-strong",
        "icon-sm": "size-10",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-floor border-2 border-current border-r-transparent"
    />
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const classes = cn(buttonVariants({ variant, size }), className)
  const unavailable = disabled || loading

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-size={size}
        data-loading={loading ? "" : undefined}
        className={classes}
        aria-busy={loading || undefined}
        {...props}
      >
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? "" : undefined}
      className={classes}
      disabled={unavailable}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
}

export { Button }
