import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, seedSettlement, seedComment, gotoApp } from './setup'
import type { Page, Download } from '@playwright/test'

/* ─── Helpers ─── */

/** Read the store state straight from localStorage. */
function getStore(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fairshare_store') || '{}'))
}

/** Read the content of a captured download. */
async function readDownload(promise: Promise<Download>): Promise<string> {
  const download = await promise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function gotoProfile(page: Page) {
  await gotoApp(page, '/profile')
  await expect(page.getByRole('heading', { name: 'Export / Import Data' })).toBeVisible()
}

/** Upload a file into the profile import input. */
async function uploadImportFile(page: Page, name: string, mimeType: string, content: string) {
  const input = page.locator('input[type="file"]')
  await input.setInputFiles({ name, mimeType, buffer: Buffer.from(content, 'utf8') })
}

/** Conveniently click a UI button and read the resulting download. */
async function clickAndDownload(page: Page, buttonName: string): Promise<string> {
  const dlPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: buttonName }).click()
  return readDownload(dlPromise)
}

/* ─── Fixture data ─── */

function splitwiseFixture(): string {
  // Date,Description,Category,Cost,Currency + per-member net share (paid − share)
  return [
    'Date,Description,Category,Cost,Currency,Alice,Bob,Charlie',
    '2026-03-01,Dinner,Dining out,30.00,USD,20.00,-10.00,-10.00',
    '2026-03-02,Taxi,Transport,12.00,USD,8.00,-4.00,-4.00',
    '2026-03-03,Bad row,Dining,abc,USD,0.00,0.00,0.00',
    'Total balance,,,42.00,USD,28.00,-14.00,-14.00',
  ].join('\r\n')
}

test.describe('F5 — Export / Import', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('JSON export renders a valid envelope with schema_version and full store', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Dinner', 'Weekly', ['Bob'])
    await seedExpense(page, 1, 'Pizza', 30)
    await gotoProfile(page)

    const json = await clickAndDownload(page, 'Export JSON')
    const envelope = JSON.parse(json)
    expect(envelope.format).toBe('fairshare-export')
    expect(envelope.schema_version).toBe(2)
    expect(envelope.source_app).toBe('fairshare')
    expect(envelope.exported_at).toBeTruthy()
    expect(Array.isArray(envelope.data.groups)).toBe(true)
    expect(Array.isArray(envelope.data.expenses)).toBe(true)
    // Groups and settlements carry a stable uuid for merge
    expect(envelope.data.groups[0].uuid).toMatch(/^[0-9a-f-]{36}$/)
  })
  test('round-trip: export JSON, wipe the store, restore — identical entities', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', 'Weekly', ['Bob'])
    const { id: expId, uuid: expUuid } = await seedExpense(page, groupId, 'Pizza', 30)
    await seedSettlement(page, groupId, 10)
    await seedComment(page, groupId, expId, expUuid, 'Tasty')
    await gotoProfile(page)

    const original = await getStore(page)
    const json = await clickAndDownload(page, 'Export JSON')

    // Wipe the store and reload so the in-memory store is empty
    await page.evaluate(() => localStorage.removeItem('fairshare_store'))
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Replace-mode import requires confirmation
    page.on('dialog', (d) => d.accept())
    await page.locator('input[type="checkbox"]').check()
    await uploadImportFile(page, 'backup.json', 'application/json', json)
    await expect(page.getByText(/Store replaced with export data\./)).toBeVisible()

    const restored = await getStore(page)
    expect(restored.groups.length).toBe(original.groups.length)
    expect(restored.expenses.length).toBe(original.expenses.length)
    expect(restored.settlements.length).toBe(original.settlements.length)
    expect(restored.comments.length).toBe(original.comments.length)
    expect(restored.groups[0].uuid).toBe(original.groups[0].uuid)
    expect(restored.expenses[0].uuid).toBe(original.expenses[0].uuid)
    expect(restored.expenses[0].amount).toBe(original.expenses[0].amount)
    // No id-counter regressions — next ids are recomputed past the max id
    expect(restored.nextExpenseId).toBeGreaterThan(Math.max(...restored.expenses.map((e: any) => e.id)))
  })

  test('merge by uuid does not duplicate a known entity on re-import', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'Pizza', 30)
    await gotoProfile(page)

    const json = await clickAndDownload(page, 'Export JSON')
    const before = await getStore(page)
    const groupCount = before.groups.length
    const expenseCount = before.expenses.length

    await uploadImportFile(page, 'backup.json', 'application/json', json)
    await expect(page.getByText(/Export data merged into the store\./)).toBeVisible()

    const after = await getStore(page)
    expect(after.groups.length).toBe(groupCount)
    expect(after.expenses.length).toBe(expenseCount)
  })

  test('merge appends new unmatched entities without losing existing ones', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Dinner', '', ['Bob'])
    await gotoProfile(page)

    // Export the current (one-group, no-expense) store
    const json = await clickAndDownload(page, 'Export JSON')
    const envelope = JSON.parse(json)
    // Add a brand-new expense (fresh uuid) pointing at the existing group uuid
    envelope.data.expenses.push({
      id: 99,
      uuid: '00000000-0000-4000-8000-000000000009',
      group_id: envelope.data.groups[0].id,
      paid_by: envelope.data.users[0].id,
      amount: 42,
      description: 'New expense',
      date: '2026-01-01',
      created_at: new Date().toISOString(),
    })
    envelope.data.nextExpenseId = 100

    await uploadImportFile(page, 'backup.json', 'application/json', JSON.stringify(envelope))
    await expect(page.getByText(/Export data merged into the store\./)).toBeVisible()

    const after = await getStore(page)
    expect(after.groups.length).toBe(1)
    expect(after.expenses.length).toBe(1)
    expect(after.expenses[0].uuid).toBe('00000000-0000-4000-8000-000000000009')
    expect(after.expenses[0].description).toBe('New expense')
  })

  test('rejects an invalid JSON file and leaves the store unchanged', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Dinner', '', ['Bob'])
    await gotoProfile(page)

    const before = await getStore(page)
    await uploadImportFile(page, 'bad.json', 'application/json', '{ this is not json')
    await expect(page.getByText(/not valid JSON/)).toBeVisible()

    const after = await getStore(page)
    expect(after.groups.length).toBe(before.groups.length)
  })

  test('rejects a JSON file from a future schema version', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Dinner', '', ['Bob'])
    await gotoProfile(page)

    const json = await clickAndDownload(page, 'Export JSON')
    const envelope = JSON.parse(json)
    envelope.schema_version = 999
    await uploadImportFile(page, 'future.json', 'application/json', JSON.stringify(envelope))
    await expect(page.getByText(/newer version of FairShare/)).toBeVisible()
  })

  test('CSV export produces three parseable files with expected columns', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', 'Weekly', ['Bob'])
    await seedExpense(page, groupId, 'Pizza, with salad', 30)

    await gotoProfile(page)
    const downloads: Download[] = []
    page.on('download', (d: Download) => downloads.push(d))
    await page.getByRole('button', { name: 'Export CSV' }).click()
    await expect.poll(() => downloads.length, { timeout: 3000 }).toBe(3)

    const names = new Set<string>()
    const contents: Record<string, string> = {}
    for (const d of downloads) {
      const name = d.suggestedFilename()
      names.add(name)
      contents[name] = await readDownload(Promise.resolve(d))
    }
    expect(names.has('expenses.csv')).toBe(true)
    expect(names.has('settlements.csv')).toBe(true)
    expect(names.has('groups.csv')).toBe(true)

    // expenses.csv is RFC-4180 parseable and contains the quoted description
    const expRows: string = contents['expenses.csv']
    expect(expRows.startsWith('\uFEFF')).toBe(true)
    expect(expRows).toContain('"Pizza, with salad"')
    // Header columns
    const headerLine = expRows.replace(/^\uFEFF/, '').split('\r\n')[0]
    expect(headerLine).toContain('group_name')
    expect(headerLine).toContain('paid_by_name')
    expect(headerLine).toContain('uuid')
  })

  test('Splitwise CSV import maps to a group, expenses and splits; bad rows reported', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoProfile(page)

    await uploadImportFile(page, 'splitwise.csv', 'text/csv', splitwiseFixture())
    await expect(page.getByText(/Imported 2 expense\(s\)\./)).toBeVisible()
    // A skipped row is reported, and the rest imported
    await expect(page.getByText(/row\(s\) skipped/)).toBeVisible()

    const after = await getStore(page)
    expect(after.groups.length).toBe(1)
    expect(after.groups[0].name).toBe('Imported from Splitwise')
    expect(after.expenses.length).toBe(2)
    // payer inferred as the max net (Alice) for the dinner row
    const dinner = after.expenses.find((e: any) => e.description === 'Dinner')
    expect(dinner).toBeTruthy()
    const alice = after.users.find((u: any) => u.name === 'Alice')
    expect(dinner.paid_by).toBe(alice.id)
    const bob = after.users.find((u: any) => u.name === 'Bob')
    const dinnerSplits = after.expenseSplits.filter((s: any) => s.expense_id === dinner.id)
    expect(dinnerSplits.find((s: any) => s.user_id === alice.id).amount).toBe(10)
    expect(dinnerSplits.find((s: any) => s.user_id === bob.id).amount).toBe(10)
  })

  test('imported data is enqueued to sync (op queue grows)', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoProfile(page)

    // Baseline queue length (may be non-zero from earlier ops)
    const base = await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_sync_queue')
      return raw ? JSON.parse(raw).length : 0
    })

    await uploadImportFile(page, 'splitwise.csv', 'text/csv', splitwiseFixture())
    await expect(page.getByText(/Imported 2 expense\(s\)\./)).toBeVisible()

    const after = await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_sync_queue')
      return raw ? JSON.parse(raw).length : 0
    })
    expect(after).toBeGreaterThan(base)
  })

  test('CSV export neutralizes formula-prefixed fields (no formula injection)', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '=2+5', ['Bob'])
    await seedExpense(page, groupId, '@SUM(A1:A2)', 30)
    await gotoProfile(page)

    const downloads: Download[] = []
    page.on('download', (d: Download) => downloads.push(d))
    await page.getByRole('button', { name: 'Export CSV' }).click()
    await expect.poll(() => downloads.length, { timeout: 3000 }).toBe(3)

    const contents: Record<string, string> = {}
    for (const d of downloads) {
      contents[d.suggestedFilename()] = await readDownload(Promise.resolve(d))
    }
    // A description starting with '@' and a description starting with '=' must
    // both be quoted so Excel/Sheets treat them as literal text, not formulas.
    expect(contents['expenses.csv']).toContain('"@SUM(A1:A2)"')
    expect(contents['groups.csv']).toContain('"=2+5"')
  })

  test('re-importing an already-present backup does not re-broadcast create ops', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'Pizza', 30)
    await gotoProfile(page)

    const json = await clickAndDownload(page, 'Export JSON')

    const before = await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_sync_queue')
      return raw ? JSON.parse(raw).length : 0
    })

    await uploadImportFile(page, 'backup.json', 'application/json', json)
    await expect(page.getByText(/Export data merged into the store\./)).toBeVisible()

    const after = await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_sync_queue')
      return raw ? JSON.parse(raw).length : 0
    })
    // Entities already present by uuid are NOT re-broadcast as create ops.
    expect(after).toBe(before)
  })
})
