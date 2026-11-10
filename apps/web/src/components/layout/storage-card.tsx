import { useUsage } from "@/hooks/use-account"
import { formatBytes } from "@/lib/format"
import type { Usage } from "@/lib/models"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Surface } from "@/components/ui/surface"

function percent(usage: Usage): number {
  if (usage.quota <= 0) return 0
  return Math.min(100, (usage.used / usage.quota) * 100)
}

export function StorageCard() {
  const usage = useUsage()

  return (
    <Surface radius="card" padding={24} className="bg-background">
      <h2 className="display-md">Storage</h2>
      {usage.isPending ? (
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : usage.isError || !usage.data ? (
        <div className="mt-3 grid gap-2">
          <p className="text-sm text-muted-foreground">Could not load storage</p>
          <button type="button" className="text-left text-sm font-bold text-brand" onClick={() => void usage.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <Progress className="mt-3" value={percent(usage.data)} />
          <p className="mt-2 text-xs text-muted-foreground">
            {formatBytes(usage.data.used)} of {formatBytes(usage.data.quota)} used
          </p>
        </>
      )}
    </Surface>
  )
}
