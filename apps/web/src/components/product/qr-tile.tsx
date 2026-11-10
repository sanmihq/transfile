import { QRCodeSVG } from "qrcode.react"

export function QrTile({ value }: { value: string }) {
  return (
    <div className="inline-flex rounded-inset bg-surface p-3">
      <QRCodeSVG value={value} size={160} aria-label="QR code for the link" />
    </div>
  )
}
