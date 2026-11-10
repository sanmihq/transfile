import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { endSession } from "@/lib/auth-client"

export function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  async function run() {
    if (pending) return
    setPending(true)
    try {
      await endSession(queryClient)
      navigate("/login", { replace: true })
    } finally {
      setPending(false)
    }
  }

  return { pending, run }
}
