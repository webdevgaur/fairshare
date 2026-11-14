/**
 * Tesseract.js worker wrapper (F1).
 *
 * Lazy-loads the Tesseract worker + WASM core + `eng` traineddata ONLY when
 * the user first taps "Scan" — never at app boot. Surfaces recognition
 * progress so the UI can show a loading state, and degrades gracefully: if the
 * worker/model fails to load, `recognizeReceipt` rejects and the caller falls
 * back to manual entry (receipt-creation is never blocked by OCR).
 *
 * Model assets are hosted locally under `public/ocr/` (worker.min.js, the
 * WASM core, and `eng.traineddata.gz`) so recognition works offline and does
 * not depend on a third-party CDN. Drop those files there to enable real
 * recognition; until present, scans fall back to manual entry.
 */

import type { OcrResult } from './receipt-parser'
import { normalizeTesseractResult } from './receipt-parser'

export interface OcrProgress {
  status: string
  progress: number
}

/**
 * Test seam. Playwright E2E tests inject a fake recognizer here so the WASM
 * model is never downloaded in CI; the mock returns a known `OcrResult` word
 * stream. Guarded to `window` so production code is unaffected.
 */
declare global {
  interface Window {
    __FAIRSHARE_TEST_OCR__?: (
      image: Blob,
      onProgress?: (p: OcrProgress) => void,
    ) => Promise<OcrResult>
  }
}

/** Singleton worker — created once, reused for every scan in the session. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workerPromise: Promise<any> | null = null

/** Local model asset path under `public/ocr/`. */
function assetPath(name: string): string {
  return `/ocr/${name}`
}

async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<any> {
  if (!workerPromise) {
    // Dynamic import → the tesseract.js module is only evaluated on first scan.
    const { createWorker } = await import('tesseract.js')
    workerPromise = createWorker('eng', 1, {
      logger: (m: { status?: string; progress?: number }) => {
        onProgress?.({ status: m.status ?? '', progress: m.progress ?? 0 })
      },
      workerPath: assetPath('worker.min.js'),
      corePath: assetPath(''),
      langPath: assetPath(''),
    })
  }
  return workerPromise
}

/**
 * Recognise text in an image entirely on-device. Returns the shared
 * `OcrResult` contract (text + geometry). Rejects on worker/model failure so
 * the caller can degrade to manual entry.
 */
export async function recognizeReceipt(
  image: Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  if (typeof window !== 'undefined' && window.__FAIRSHARE_TEST_OCR__) {
    return window.__FAIRSHARE_TEST_OCR__(image, onProgress)
  }
  const worker = await getWorker(onProgress)
  const { data } = await worker.recognize(image, {}, { blocks: true })
  return normalizeTesseractResult(data)
}

/** Tear down the worker and free the WASM instance (best-effort). */
export function terminateWorker(): void {
  if (!workerPromise) return
  workerPromise
    .then((w) => w?.terminate?.())
    .catch(() => {
      /* ignore */
    })
  workerPromise = null
}
