import { Link } from "react-router-dom"
import { PublicLayout } from "@/components/layout/public-layout"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/ui/surface"

export default function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="flex min-h-dvh items-center justify-center px-4 py-24">
      <Surface radius="card" padding={24} className="mx-auto w-full max-w-sm bg-background text-center text-foreground shadow-soft">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="display-lg mt-2">That page is missing</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The link may be wrong, or the page has not been built yet.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/">Back home</Link>
        </Button>
      </Surface>
      </div>
    </PublicLayout>
  )
}
