/**
 * Minimal type declarations for lazy-loaded QR libraries.
 * These are pure-JS packages without bundled types; we declare just enough
 * for the F8 QR components to type-check.
 */

declare module 'qrcode' {
  interface QrCodeOptions {
    type?: 'svg' | 'utf8' | 'terminal'
    width?: number
    height?: number
  }
  interface QrCodeModule {
    toString(text: string, options?: QrCodeOptions): string
  }
  const qrcode: QrCodeModule
  export default qrcode
}

declare module 'jsqr' {
  interface QrCodeResult {
    data: string
    binaryData: number[]
    version: number
    location: Record<string, { x: number; y: number }>
  }
  interface JsQrOptions {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst'
  }
  function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: JsQrOptions,
  ): QrCodeResult | null
  export default jsQR
}