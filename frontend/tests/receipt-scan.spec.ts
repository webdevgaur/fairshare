import { test, expect, clearStorage, seedIdentity, seedGroup, gotoApp } from './setup'

// A tiny valid PNG so the browser can decode the uploaded receipt image.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const RECEIPT_FILE = {
  name: 'receipt.png',
  mimeType: 'image/png',
  buffer: Buffer.from(PNG_BASE64, 'base64'),
}

/**
 * Self-contained functions passed to `page.addInitScript`. Playwright
 * serializes only the function body into the browser context, so EVERYTHING
 * (including the mocked recognizer and its geometry) must be defined inline —
 * no closure over Node-scope consts. These produce a known OcrResult word
 * stream: top line = merchant, bottom "TOTAL" line = grand total.
 */
function installMockOcr() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__FAIRSHARE_TEST_OCR__ = (_image: any, onProgress?: any) => {
    onProgress?.({ status: 'recognizing text', progress: 1 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mk = (y: number, text: string) => ({
      text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      words: text.split(/\s+/).map((t: string) => ({ text: t, confidence: 90, boundingBox: { x0: 0, y0: y, x1: 400, y1: y + 10 } })),
      boundingBox: { x0: 0, y0: y, x1: 400, y1: y + 10 },
      confidence: 90,
    })
    const lines = [
      mk(0, 'WHOLE FOODS MARKET'),
      mk(20, '123 Main St'),
      mk(40, '01/15/2026'),
      mk(60, 'Bread 4.50'),
      mk(80, 'Milk 3.99'),
      mk(100, 'TAX 0.65'),
      mk(120, 'TOTAL 9.14'),
    ]
    return Promise.resolve({
      text: lines.map((l: { text: string }) => l.text).join('\n'),
      blocks: [{ text: '', lines, boundingBox: { x0: 0, y0: 0, x1: 400, y1: 130 }, confidence: 90 }],
    })
  }
}

function installMockOcrFail() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__FAIRSHARE_TEST_OCR__ = () => Promise.reject(new Error('model load failed'))
}

test.describe('Receipt scanning & OCR (F1)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('scan receipt extracts line items and creates all expenses', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob', 'Charlie'])
    await page.addInitScript(installMockOcr)
    await gotoApp(page, `/groups/${groupId}`)

    await expect(page.getByText('No expenses yet')).toBeVisible()

    await page.getByTestId('scan-receipt-button').click()
    await page.getByTestId('receipt-file-input').setInputFiles(RECEIPT_FILE)

    // Review-and-assign grid appears with the parsed line items.
    await expect(page.getByTestId('receipt-review')).toBeVisible()
    await expect(page.getByTestId('receipt-item-desc-0')).toHaveValue('Bread')
    await expect(page.getByTestId('receipt-item-amount-0')).toHaveValue('4.5')
    await expect(page.getByTestId('receipt-item-desc-1')).toHaveValue('Milk')
    await expect(page.getByTestId('receipt-item-amount-1')).toHaveValue('3.99')

    // One tap creates all expenses.
    await page.getByTestId('receipt-create-all').click()

    await expect(page.getByText('Bread')).toBeVisible()
    await expect(page.getByText('$4.50').first()).toBeVisible()
    await expect(page.getByText('Milk')).toBeVisible()
    await expect(page.getByText('$3.99').first()).toBeVisible()
  })

  test('scanned expenses carry a uuid and no image in the sync payload', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob', 'Charlie'])
    await page.addInitScript(installMockOcr)
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId('scan-receipt-button').click()
    await page.getByTestId('receipt-file-input').setInputFiles(RECEIPT_FILE)
    await expect(page.getByTestId('receipt-review')).toBeVisible()
    await page.getByTestId('receipt-create-all').click()

    // Inspect the sync queue: each create_expense op has a uuid, and no op
    // carries image bytes (privacy).
    const raw = await page.evaluate(() => localStorage.getItem('fairshare_sync_queue'))
    expect(raw).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops = JSON.parse(raw as string).map((q: { op: any }) => q.op)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expOps = ops.filter((o: any) => o.type === 'create_expense')
    expect(expOps.length).toBe(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uuids = expOps.map((o: any) => o.data.uuid)
    for (const u of uuids) expect(u).toBeTruthy()
    expect(new Set(uuids).size).toBe(expOps.length) // distinct per item (F6)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of expOps) {
      expect(Object.prototype.hasOwnProperty.call(o.data, 'image')).toBe(false)
      expect(o.data.image).toBeUndefined()
    }
    expect(raw).not.toContain('data:image')
  })

  test('receipt image is stored in IndexedDB, not localStorage', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await page.addInitScript(installMockOcr)
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId('scan-receipt-button').click()
    await page.getByTestId('receipt-file-input').setInputFiles(RECEIPT_FILE)
    await expect(page.getByTestId('receipt-review')).toBeVisible()
    await page.getByTestId('receipt-create-all').click()

    // The blob lands in IndexedDB (fairshare_receipts), never localStorage.
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open('fairshare_receipts')
          req.onsuccess = () => {
            const tx = req.result.transaction('receipts')
            const count = tx.objectStore('receipts').count()
            count.onsuccess = () => resolve(count.result > 0)
            count.onerror = () => resolve(false)
          }
          req.onerror = () => resolve(false)
        }),
    )
    const hasStoreKey = await page.evaluate(() => localStorage.hasOwnProperty('fairshare_store'))
    expect(hasStoreKey).toBe(true) // structured store untouched
  })

  test('falls back to manual entry when OCR fails', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await page.addInitScript(installMockOcrFail)
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId('scan-receipt-button').click()
    await page.getByTestId('receipt-file-input').setInputFiles(RECEIPT_FILE)

    await expect(page.getByTestId('scan-receipt-error')).toBeVisible()

    // Manual entry still works — an unusable scan does not block creation.
    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Manual entry')
    await page.getByPlaceholder('Amount').first().fill('10')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Manual entry')).toBeVisible()
  })
})
