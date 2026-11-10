import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import { GuestSessionProvider } from "@/components/product/guest-provider"
import { Toaster } from "@/components/ui/sonner"
import { UploadProvider } from "@/features/upload/engine"
import { queryClient } from "@/lib/query"
import { router } from "@/router"

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GuestSessionProvider>
        <UploadProvider>
          <RouterProvider router={router} />
          <Toaster />
        </UploadProvider>
      </GuestSessionProvider>
    </QueryClientProvider>
  )
}
