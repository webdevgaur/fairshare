import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { recognizeReceipt, type OcrProgress } from '@/lib/ocr'
import type { OcrResult } from '@/lib/receipt-parser'

/**
 * Camera / photo-picker + OCR progress UI (F1).
 *
 * The user taps "Scan Receipt", picks or captures an image, and we run OCR
 * fully on-device (Tesseract.js / WASM). The image is compressed before OCR
 * and on success handed to the parent along with the recognised text. If OCR
 * fails (e.g. the model is not yet provisioned), we surface a friendly error
 * and the caller falls back to manual entry — a bad scan never blocks
 * expense creation.
 */
export default function ReceiptScanner({
  onScan,
  onCancel,
}: {
  onScan: (image: Blob, result: OcrResult) => void
  onCancel?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    if (!file) return
    setBusy(true)
    setError(null)
    setProgress({ status: 'recognizing', progress: 0 })
    try {
      const image = await compressImage(file)
      const result = await recognizeReceipt(image, setProgress)
      onScan(image, result)
    } catch (e) {
      setError('Could not read this receipt. You can still add the expense manually.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Scan Receipt</h3>
        <p className="text-xs text-slate-400">
          OCR runs on your device — the image never leaves it.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          data-testid="receipt-file-input"
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
          data-testid="scan-receipt-choose"
        >
          Choose photo
        </Button>

        {busy && (
          <div data-testid="scan-receipt-progress" className="space-y-1">
            <p className="text-xs text-slate-500">
              Recognizing… {progress ? `(${Math.round(progress.progress * 100)}%)` : ''}
            </p>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-slate-400 transition-all"
                style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-rose-500" data-testid="scan-receipt-error">
            {error}
          </p>
        )}

        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy} data-testid="scan-receipt-cancel">
            Cancel
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * Downscale an image to a max 1600px-wide JPEG so the blob stored in IndexedDB
 * (and the input to OCR) stays small. Best-effort: if the browser can't decode
 * the file, fall back to the original blob rather than blocking the scan.
 */
async function compressImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const maxW = 1600
    const scale = Math.min(1, maxW / (bitmap.width || maxW))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.8)
    })
  } catch {
    return file
  }
}
