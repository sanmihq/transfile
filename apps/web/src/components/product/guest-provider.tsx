import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile"
import { useRef, type ReactNode } from "react"
import { ApiError } from "@/lib/api"
import { GuestTokenContext } from "@/lib/guest-token"
import { turnstileSiteKey } from "@/lib/session"

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const widget = useRef<TurnstileInstance>(undefined)

  async function token(): Promise<string> {
    const instance = widget.current
    if (!instance) {
      throw new ApiError(400, "The security check is not ready yet. Try again.")
    }
    instance.execute()
    try {
      const value = await instance.getResponsePromise(15_000)
      instance.reset()
      return value
    } catch {
      instance.reset()
      throw new ApiError(400, "The security check failed. Try again.")
    }
  }

  return (
    <GuestTokenContext.Provider value={token}>
      {children}
      <div className="pointer-events-none absolute size-0 overflow-hidden" aria-hidden="true">
        <Turnstile
          ref={widget}
          siteKey={turnstileSiteKey()}
          options={{
            size: "invisible",
            execution: "execute",
            appearance: "interaction-only",
            responseField: false,
          }}
        />
      </div>
    </GuestTokenContext.Provider>
  )
}
