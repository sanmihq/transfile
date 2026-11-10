import { Skeleton } from "@/components/ui/skeleton"

export function AuthSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="grid w-full max-w-sm gap-4">
        <Skeleton className="mx-auto h-8 w-36 bg-background" />
        <Skeleton className="h-80 w-full rounded-card bg-background" />
      </div>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-40 w-full rounded-card" />
    </div>
  )
}
