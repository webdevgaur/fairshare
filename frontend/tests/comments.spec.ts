import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, seedComment, gotoApp } from './setup'

test.describe('F6 — Expense Comments', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('expenses carry a stable uuid persisted in the store', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Pizza')
    await page.getByPlaceholder('Amount').first().fill('30')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    const store = await page.evaluate(() => JSON.parse(localStorage.getItem('fairshare_store') || '{}'))
    const exp = store.expenses[0]
    expect(exp.uuid).toBeTruthy()
    // crypto.randomUUID() format
    expect(exp.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test('a user can open an expense and add a text comment', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    const { uuid } = await seedExpense(page, groupId, 'Pizza', 30)
    await gotoApp(page, `/groups/${groupId}`)

    // Open the comment thread on the expense card
    await page.getByTestId(`expense-comments-toggle-${uuid}`).click()
    await page.getByTestId(`comment-input-${uuid}`).fill('That was great!')
    await page.getByTestId(`comment-post-${uuid}`).click()

    // Comment text appears in the thread, and the badge shows the count
    await expect(page.getByText('That was great!')).toBeVisible()
    await expect(page.getByTestId(`expense-comments-toggle-${uuid}`)).toContainText('1 comment')
  })

  test('comment is attributed to the current user', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    const { uuid } = await seedExpense(page, groupId, 'Pizza', 30)
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId(`expense-comments-toggle-${uuid}`).click()
    await page.getByTestId(`comment-input-${uuid}`).fill('Count me in')
    await page.getByTestId(`comment-post-${uuid}`).click()

    const thread = page.locator(`[data-testid="expense-comments-${uuid}"]`)
    // The current user is shown as "You" and the comment text is present
    await expect(thread.getByText('You').first()).toBeVisible()
    await expect(thread.getByText('Count me in')).toBeVisible()
  })

  test('a comment attaches to the same expense by uuid and renders', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', '', ['Bob'])
    const { id, uuid } = await seedExpense(page, groupId, 'Hotel', 200)
    await seedComment(page, groupId, id, uuid, 'Split by nights')
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId(`expense-comments-toggle-${uuid}`).click()
    await expect(page.getByText('Split by nights')).toBeVisible()
  })

  test('comment for a not-yet-synced expense is stored but not rendered', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', '', ['Bob'])
    // Reference an expense that isn't present on this device
    await seedComment(page, groupId, 999, 'not-a-real-expense-uuid', 'Ghost comment')
    await gotoApp(page, `/groups/${groupId}`)

    // The feed is empty — the comment references an absent expense
    await expect(page.getByText('No expenses yet')).toBeVisible()
    await expect(page.getByText('Ghost comment')).not.toBeVisible()
  })

  test('creating a comment does not duplicate it', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    const { uuid } = await seedExpense(page, groupId, 'Pizza', 30)
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByTestId(`expense-comments-toggle-${uuid}`).click()
    await page.getByTestId(`comment-input-${uuid}`).fill('No dupes')
    await page.getByTestId(`comment-post-${uuid}`).click()

    // Exactly one rendered instance of the comment text
    await expect(page.getByText('No dupes')).toHaveCount(1)
  })
})
