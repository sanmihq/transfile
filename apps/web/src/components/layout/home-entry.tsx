import { Suspense } from "react"
import { AppShell } from "@/components/layout/app-shell"
import { SendSkeleton } from "@/components/layout/skeletons"
import { PublicLayout } from "@/components/layout/public-layout"
import { useSession } from "@/lib/auth-client"
import { isMember } from "@/lib/session"
import { SendPage } from "@/pages/lazy-pages"

export function HomeEntry() {
  const { data, isPending } = useSession()
  if (isPending) {
    return (
      <PublicLayout>
        <SendSkeleton />
      </PublicLayout>
    )
  }

  const page = (
    <Suspense fallback={<SendSkeleton />}>
      <SendPage />
    </Suspense>
  )

  if (isMember(data?.user)) return <AppShell>{page}</AppShell>
  return <PublicLayout>{page}</PublicLayout>
}
