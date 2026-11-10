export function Wordmark({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-control bg-ink text-white"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none">
          <path
            d="M8 12.5V3.5M8 3.5 4.5 7M8 3.5 11.5 7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {markOnly ? null : <span className="display-md text-[1.35rem]">Transfile</span>}
    </span>
  )
}
