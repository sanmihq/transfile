import { StorageCard } from "@/components/layout/storage-card"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/ui/surface"
import { useMe } from "@/hooks/use-account"
import { useSignOut } from "@/hooks/use-sign-out"
import { useSession } from "@/lib/auth-client"

export default function SettingsPage() {
  const session = useSession()
  const me = useMe()
  const signOut = useSignOut()
  const name = me.data?.name || session.data?.user.name || "Account"
  const email = me.data?.email || session.data?.user.email || ""

  return (
    <div className="grid gap-6">
      <h1 className="display-lg">Settings</h1>
      <Surface radius="card" padding={24} className="bg-surface">
        <h2 className="display-md">Account</h2>
        <p className="mt-3 text-lg font-medium">{name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>
      </Surface>
      <StorageCard />
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        loading={signOut.pending}
        disabled={signOut.pending}
        onClick={() => {
          void signOut.run()
        }}
      >
        Sign out
      </Button>
      <Surface id="about" radius="card" padding={24} className="bg-surface">
        <h2 className="display-md">About</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          <a href="https://lucide.dev" className="font-medium text-brand">
            Icons by Lucide
          </a>
        </p>
      </Surface>
    </div>
  )
}
