import { createContext, useContext } from "react"

export const GuestTokenContext = createContext<(() => Promise<string>) | null>(null)

export function useGuestToken(): () => Promise<string> {
  const value = useContext(GuestTokenContext)
  if (!value) {
    throw new Error("Guest session is unavailable")
  }
  return value
}
