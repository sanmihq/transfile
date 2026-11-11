import { Skeleton } from "@/components/ui/skeleton"
import { Surface } from "@/components/ui/surface"

export function AuthSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl items-center justify-center px-4 py-24" role="status" aria-label="Loading">
      <Surface radius="sheet" padding={20} className="w-full bg-background">
        <Skeleton className="h-8 w-28 rounded-control" />
        <Skeleton className="mt-8 h-8 w-44" />
        <Skeleton className="mt-3 h-4 w-full" />
        <div className="mt-8 grid gap-4">
          <Skeleton className="h-12 w-full rounded-inset" />
          <Skeleton className="h-12 w-full rounded-inset" />
          <Skeleton className="h-12 w-full rounded-inset" />
        </div>
      </Surface>
    </div>
  )
}

export function SendSkeleton() {
  return (
    <section className="relative min-h-dvh" role="status" aria-label="Loading">
      <div className="relative z-10 flex min-h-dvh items-center px-4 py-24 md:px-8 lg:px-12">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] lg:gap-14">
          <div className="order-1 max-w-xl lg:order-2">
            <Skeleton className="h-9 w-4/5 bg-cloud/35" />
            <Skeleton className="mt-3 h-9 w-3/5 bg-cloud/35" />
            <Skeleton className="mt-4 h-4 w-2/3 bg-cloud/25" />
          </div>
          <Surface radius="card" padding={16} className="order-2 w-full bg-background lg:order-1">
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-32 rounded-inset" />
              <Skeleton className="h-32 rounded-inset" />
            </div>
            <Skeleton className="mt-4 h-12 rounded-inset" />
            <Skeleton className="mt-3 h-24 rounded-inset" />
            <Skeleton className="mt-3 h-12 rounded-inset" />
          </Surface>
        </div>
      </div>
    </section>
  )
}

export function PageSkeleton() {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20 rounded-control" />
          <Skeleton className="h-10 w-24 rounded-control" />
        </div>
      </div>
      <ListSkeleton />
    </div>
  )
}

export function ListSkeleton() {
  return (
    <div className="grid gap-3">
      {["one", "two", "three"].map((key) => (
        <div key={key} className="flex items-center gap-3 rounded-card bg-surface p-3">
          <Skeleton className="size-10 shrink-0 rounded-control" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
