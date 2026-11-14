/**
 * Shared receipt-parsing contract + heuristic parser (F1).
 *
 * The `OcrResult` shape mirrors the contract defined in the ADR so that any
 * on-device engine (Tesseract.js on web, Apple Vision on iOS, ML Kit on
 * Android) can be mapped onto it. Only the *text + geometry* is engine
 * specific — extracting structured expense fields (merchant, date, total,
 * line items, tax, tip) is done here, in shared TypeScript, so it is written
 * once and reused by every platform.
 *
 * The parser is deliberately best-effort. Receipts are messy (multi-line
 * items, coupons, low-contrast thermal print). We prefer to return a
 * reasonable suggestion and let the human review grid correct it, rather than
 * chase accuracy with ever-more regex.
 */

export interface OcrBoundingBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  boundingBox: OcrBoundingBox
  confidence: number
}

export interface OcrLine {
  text: string
  words: OcrWord[]
  boundingBox: OcrBoundingBox
  confidence: number
}

export interface OcrBlock {
  text: string
  lines: OcrLine[]
  boundingBox: OcrBoundingBox
  confidence: number
}

/** The cross-platform OCR output contract (text + geometry). */
export interface OcrResult {
  text: string
  blocks: OcrBlock[]
}

/** A single suggested expense extracted from a receipt. */
export interface ParsedLineItem {
  description: string
  amount: number
}

/** Structured fields parsed out of a receipt, best-effort. */
export interface ParsedReceipt {
  merchant?: string
  /** Business date, YYYY-MM-DD. */
  date?: string
  total?: number
  tax?: number
  tip?: number
  items: ParsedLineItem[]
}

/* ─── Amount / date extraction ─── */

// Require either a leading "$" or an explicit ".dd" decimal so bare integers
// (quantities, street numbers, "2026" in a date) are not mistaken for money.
const CURRENCY_RE = /(\$\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2}))/g

function extractAmounts(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(CURRENCY_RE)) {
    const cleaned = m[1].replace(/[$,]/g, '')
    const n = parseFloat(cleaned)
    if (!Number.isNaN(n) && n > 0) out.push(n)
  }
  return out
}

/** Clean a currency token like "$4.50" into 4.5 (drops any comma/leading $). */
function toAmount(raw: string): number {
  const n = parseFloat(raw.replace(/[$,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

const DATE_RE =
  /(\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b)|(\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b)/

function normalizeDate(raw: string): string | undefined {
  // Accept MM/DD/YYYY, MM/DD/YY, and YYYY-MM-DD; emit YYYY-MM-DD when possible.
  const s = raw.trim()
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const m2 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (m2) {
    const year = m2[3].length === 2 ? `20${m2[3]}` : m2[3]
    return `${year}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  }
  return undefined
}

/* ─── Line-level shaping ─── */

function collectLines(result: OcrResult): OcrLine[] {
  const lines: OcrLine[] = []
  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.text.trim()) lines.push(line)
    }
  }
  // Fallback: if the engine only gave us raw text (no blocks), split on newlines.
  if (lines.length === 0 && result.text) {
    for (const t of result.text.split('\n')) {
      if (!t.trim()) continue
      const words = t.split(/\s+/).map((w) => ({
        text: w,
        confidence: 100,
        boundingBox: { x0: 0, y0: 0, x1: 0, y1: 0 } as OcrBoundingBox,
      }))
      lines.push({ text: t.trim(), words, boundingBox: { x0: 0, y0: 0, x1: 0, y1: 0 }, confidence: 100 })
    }
  }
  return lines
}

// Prefix match so a label AND its amount on the same line ("TOTAL 9.14") are
// recognised, not just a bare "TOTAL" line.
const LABEL_PREFIX_RE =
  /^(subtotal|tax|tip|gratuity|total|grand[ ]?total|amount[ ]?due|balance|due|change|cash|card|paid|vat|gst|hst|sales[ ]?tax|discount|savings)/i

function isSummaryLabel(text: string): boolean {
  return LABEL_PREFIX_RE.test(text.trim())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/* ─── Public parser ─── */

/**
 * Best-effort parse of a receipt's OCR text into structured expense fields.
 * Position-aware where possible: the total is chosen from a line labelled
 * TOTAL/AMOUNT DUE (or, failing that, the largest amount), and the merchant
 * from the top-most text line. Poorly-recognised receipts yield fewer items —
 * the review grid is the safety net, not this function.
 */
export function parseReceipt(result: OcrResult): ParsedReceipt {
  const lines = collectLines(result)
  const items: ParsedLineItem[] = []
  let merchant: string | undefined
  let date: string | undefined
  let total: number | undefined
  let tax: number | undefined
  let tip: number | undefined

  const summaryIndexes = new Set<number>()

  // Pass 1 — headers (merchant + date) and summary lines (total/tax/tip).
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].text.trim()
    if (!normalized) continue

    if (!merchant) {
      const amounts = extractAmounts(normalized)
      const isDate = DATE_RE.test(normalized)
      const alpha = normalized.replace(/[^A-Za-z ]/g, '').trim()
      if (alpha.length > 2 && amounts.length === 0 && !isDate) merchant = normalized
    }

    if (!date) {
      const dm = normalized.match(DATE_RE)
      if (dm) date = normalizeDate(dm[0])
    }

    if (isSummaryLabel(normalized)) summaryIndexes.add(i)

    const label = normalized.match(LABEL_PREFIX_RE)
    if (label) {
      const amounts = extractAmounts(normalized)
      if (amounts.length > 0) {
        const amt = Math.max(...amounts)
        const key = label[1].toLowerCase().replace(/\s+/g, ' ')
        if (key === 'total' || key === 'grand total' || key === 'amount due' || key === 'balance') {
          total = round2(amt)
        } else if (['tax', 'sales tax', 'vat', 'gst', 'hst'].includes(key)) {
          tax = round2(amt)
        } else if (key === 'tip' || key === 'gratuity') {
          tip = round2(amt)
        }
      }
    }
  }

  // Pass 2 — line items: descriptive text + a currency amount, not a summary.
  for (let i = 0; i < lines.length; i++) {
    if (summaryIndexes.has(i)) continue
    const normalized = lines[i].text.trim()
    if (!normalized) continue

    if (normalized === merchant || DATE_RE.test(normalized)) continue

    const matches = [...normalized.matchAll(CURRENCY_RE)].map((mm) => mm[1])
    if (matches.length === 0) continue

    // The amount on an item line is the LAST currency token (right-aligned).
    const amount = toAmount(matches[matches.length - 1])
    if (!amount || amount <= 0.01) continue

    const description = normalized
      .replace(CURRENCY_RE, '')
      .replace(/[|_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // Skip lines that are only a number (no real description) — likely a total.
    if (description.replace(/[^A-Za-z]/g, '').length < 2) continue

    items.push({ description: description || normalized, amount: round2(amount) })
  }

  // Pass 3 — total fallback: largest amount seen (only if no labelled total).
  if (total === undefined) {
    let best = 0
    for (const line of lines) {
      if (isSummaryLabel(line.text)) continue
      for (const a of extractAmounts(line.text)) if (a > best) best = a
    }
    if (best > 0) total = round2(best)
  }

  return { merchant, date, total, tax, tip, items }
}

/* ─── OCR result normalisation (engine → shared contract) ─── */

/**
 * Map a Tesseract.js v5 recognition result onto the shared `OcrResult`
 * contract. Tesseract nests block → paragraph → line → word; we flatten the
 * paragraphs out (they add no field-level value for receipts) so every engine
 * emits the same, simple shape.
 */
export function normalizeTesseractResult(data: unknown): OcrResult {
  const d = data as {
    text?: string
    blocks?: Array<{
      text?: string
      confidence?: number
      bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
      paragraphs?: Array<{
        lines?: Array<{
          text?: string
          confidence?: number
          bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
          words?: Array<{ text?: string; confidence?: number; bbox?: { x0?: number; y0?: number; x1?: number; y1?: number } }>
        }>
      }>
    }>
  }

  const blocks: OcrBlock[] = []
  for (const b of d.blocks ?? []) {
    const lines: OcrLine[] = []
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const words: OcrWord[] = (l.words ?? []).map((w) => ({
          text: w.text ?? '',
          confidence: w.confidence ?? 0,
          boundingBox: box(w.bbox),
        }))
        lines.push({
          text: l.text ?? '',
          words,
          boundingBox: box(l.bbox),
          confidence: l.confidence ?? 0,
        })
      }
    }
    blocks.push({
      text: b.text ?? '',
      lines,
      boundingBox: box(b.bbox),
      confidence: b.confidence ?? 0,
    })
  }

  return { text: d.text ?? '', blocks }
}

function box(b?: { x0?: number; y0?: number; x1?: number; y1?: number }): OcrBoundingBox {
  return { x0: b?.x0 ?? 0, y0: b?.y0 ?? 0, x1: b?.x1 ?? 0, y1: b?.y1 ?? 0 }
}
