import { useEffect, useState } from 'react'

/**
 * Render a QR code as an SVG element for the given text string (F8).
 *
 * Uses the `qrcode` library (lazy-loaded) to generate a QR matrix and returns
 * an SVG image via data URI. Dark modules on a light background with standard
 * QR finder patterns.
 *
 * The library is dynamically imported so it does not inflate startup time
 * (matching the F1 lazy-load pattern).
 */
export default function QrCode({
  data,
  size = 200,
}: {
  data: string
  size?: number
}) {
  const [svgDataUri, setSvgDataUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        // Lazy-load the qrcode library (tiny, ~25KB pure JS)
        const mod = await import('qrcode')
        const QRCode = mod.default ?? mod

        // Generate SVG string — toString returns the string directly
        // when no callback is supplied (synchronous for CPU-bound work).
        const svgStr: string =
          QRCode.toString(data, { type: 'svg', width: size, height: size })

        if (cancelled) return

        // Strip any XML declaration; keep only the <svg> element.
        const clean = svgStr.replace(/^<\?xml[\s\S]*?\?>/, '').trim()

        // Encode as a data URI so React can render it via an <img> tag.
        const uri = `data:image/svg+xml,${encodeURIComponent(clean)}`
        setSvgDataUri(uri)
      } catch {
        if (!cancelled) setError('Could not generate QR code')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [data, size])

  /* ─── Loading state ─── */
  if (loading || !svgDataUri) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-slate-400">Generating QR…</span>
      </div>
    )
  }

  /* ─── Error state ─── */
  if (error) {
    return <p className="text-xs text-rose-500">{error}</p>
  }

  /* ─── QR image (SVG data URI) ─── */
  return (
    <img
      src={svgDataUri}
      width={size}
      height={size}
      alt="QR Code"
      className="block"
    />
  )
}