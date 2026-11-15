import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { parseIdentityQR } from '@/lib/invites'

/**
 * Camera / photo-picker + QR decode UI (F8).
 *
 * Mirrors the ReceiptScanner pattern: the user picks an image containing a
 * friend's identity QR, the scan decodes it locally via jsQR (lazy-loaded),
 * and the result is handed to the caller as `{ userId, name }`.
 *
 * On-board scanning happens entirely on-device — the image never leaves.
 * The `jsQR` library is dynamically imported so startup stays fast.
 */
export default function QrScanner({
  onScan,
  onCancel,
}: {
  onScan: (decoded: { userId: string; name: string }) => void
  onCancel?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    if (!file) return
    setBusy(true)
    setError(null)

    try {
      // Decode the image into RGBA pixel data for jsQR.
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not read image')

      ctx.drawImage(bitmap, 0, 0)
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

      // Lazy-load the QR decoder.
      const { default: jsQR } = await import('jsqr')

      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (!code) throw new Error('No QR code found in the image')

      // Parse the identity payload from the QR.
      const identity = parseIdentityQR(code.data)
      if (!identity) throw new Error('QR code does not contain a valid identity')

      onScan({ userId: identity.id, name: identity.name })
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not read QR code from the image',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Scan QR Code</h3>
        <p className="text-xs text-slate-400">
          Pick a photo containing a friend's QR code to scan.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          data-testid="qr-file-input"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />

        <Button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid="scan-qr-choose"
        >
          Choose photo
        </Button>

        {busy && (
          <div data-testid="scan-qr-progress" className="space-y-1">
            <p className="text-xs text-slate-500">Decoding QR code…</p>
          </div>
        )}

        {error && (
          <p className="text-xs text-rose-500" data-testid="scan-qr-error">
            {error}
          </p>
        )}

        {onCancel && (
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid="scan-qr-cancel"
          >
            Cancel
          </Button>
        )}
      </div>
    </Card>
  )
}