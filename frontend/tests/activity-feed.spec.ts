import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, seedSettlement, seedComment, gotoApp } from './setup'

test.describe('F6 — Activity Feed', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows the empty state when a group has no activity', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Empty Group', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    await expect(page.getByText('No expenses yet')).toBeVisible()
    await expect(page.getByText('Tap "Add Expense" to split your first bill')).toBeVisible()
  })

  test('merges expenses, settlements, and comments in reverse-chronological order', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', '', ['Bob'])
    // Order of creation: expense (oldest) → settlement → comment (newest)
    const { id, uuid } = await seedExpense(page, groupId, 'Hotel', 200)
    await seedSettlement(page, groupId, 100)
    await seedComment(page, groupId, id, uuid, 'Great stay!')
    await gotoApp(page, `/groups/${groupId}`)

    const feed = page.locator('[data-testid="activity-feed"]')
    await expect(feed).toBeVisible()
    const text = await feed.innerText()

    // Newest on top: comment first, then settlement, then the expense
    const idxComment = text.indexOf('commented')
    const idxSettlement = text.indexOf('paid')
    const idxExpense = text.indexOf('Hotel')
    expect(idxComment).toBeGreaterThanOrEqual(0)
    expect(idxSettlement).toBeGreaterThan(idxComment)
    expect(idxExpense).toBeGreaterThan(idxSettlement)
  })

  test('groups activity under a date header', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', '', ['Bob'])
    await seedExpense(page, groupId, 'Hotel', 200)
    await gotoApp(page, `/groups/${groupId}`)

    const today = new Date().toISOString().slice(0, 10)
    const feed = page.locator('[data-testid="activity-feed"]')
    // Date header appears at least once (first() guards against the same
    // ISO date string also appearing on the expense card).
    await expect(feed.getByText(today).first()).toBeVisible()
  })

  test('wires comment components into expense cards', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', '', ['Bob'])
    const { id, uuid } = await seedExpense(page, groupId, 'Hotel', 200)
    await seedComment(page, groupId, id, uuid, 'Split by nights')
    await gotoApp(page, `/groups/${groupId}`)

    // The expense card exposes a comment toggle reflecting the count
    await expect(page.getByTestId(`expense-comments-toggle-${uuid}`)).toContainText('1 comment')
  })

  test('a settlement line appears in the feed', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Household', '', ['Bob'])
    await seedExpense(page, groupId, 'Groceries', 100)
    await seedSettlement(page, groupId, 50)
    await gotoApp(page, `/groups/${groupId}`)

    await expect(page.getByText('paid').first()).toBeVisible()
    await expect(page.getByText('$50.00').first()).toBeVisible()
  })
})
