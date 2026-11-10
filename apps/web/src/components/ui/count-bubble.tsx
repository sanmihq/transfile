export function CountBubble({ count, cap = 9 }: { count: number; cap?: number }) {
  if (count <= 0) return null
  const label = count > cap ? `${cap}+` : String(count)
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-coral text-[10px] font-bold text-white"
    >
      {label}
    </span>
  )
}
