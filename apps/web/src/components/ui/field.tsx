import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

type FieldControlProps = {
  id?: string
  "aria-invalid"?: boolean | undefined
  "aria-describedby"?: string | undefined
}

function Field({
  label,
  htmlFor,
  error,
  trailing,
  children,
  className,
}: {
  label: string
  htmlFor: string
  error?: string
  trailing?: React.ReactNode
  children: React.ReactElement<FieldControlProps>
  className?: string
}) {
  const errorId = `${htmlFor}-error`
  const control = React.cloneElement(children, {
    id: htmlFor,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  })

  return (
    <div data-slot="field" className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="relative">
        {control}
        {trailing ? (
          <div className="absolute inset-y-0 right-1 flex items-center">
            {trailing}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { Field, Label }
