import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'

test.describe('F3 — Spending Insights & Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('empty state renders the analytics section without crashing', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page, '/')

    await expect(page.getByText('Spending Insights')).toBeVisible()
    await expect(page.getByText('No spending yet')).toBeVisible()
    await expect(page.getByTestId('analytics-this-month')).toContainText('$0.00')
    await expect(page.getByTestId('analytics-last-month')).toContainText('$0.00')
    await expect(page.getByTestId('analytics-all-time')).toContainText('$0.00')
  })

  test('category breakdown sums correctly and folds unknown/unassigned into Other', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'Pizza', 30, { category: 'Food', date: '2026-03-01' })
    await seedExpense(page, groupId, 'Sushi', 20, { category: 'Food', date: '2026-03-02' })
    await seedExpense(page, groupId, 'Taxi', 10, { category: 'Transport', date: '2026-03-03' })
    await seedExpense(page, groupId, 'Coffee', 5, { category: 'Coffee', date: '2026-03-04' })
    await seedExpense(page, groupId, 'Snacks', 15, { date: '2026-03-05' })
    await gotoApp(page, '/')

    // All-time = 30 + 20 + 10 + 5 + 15 = $80.00
    await expect(page.getByTestId('analytics-all-time')).toContainText('$80.00')
    // Expenses are dated March 2026, so this/last month are $0.00
    await expect(page.getByTestId('analytics-this-month')).toContainText('$0.00')

    // Food = 50; Transport = 10; Other = 5 (Coffee) + 15 (Snacks) = 20
    await expect(page.getByTestId('category-amount-Food')).toHaveText('$50.00')
    await expect(page.getByTestId('category-amount-Transport')).toHaveText('$10.00')
    await expect(page.getByTestId('category-amount-Other')).toHaveText('$20.00')
  })

  test('this-month and all-time cards reflect expenses created today', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'Today Lunch', 42)
    await gotoApp(page, '/')

    await expect(page.getByTestId('analytics-this-month')).toContainText('$42.00')
    await expect(page.getByTestId('analytics-all-time')).toContainText('$42.00')
    await expect(page.getByTestId('analytics-last-month')).toContainText('$0.00')
  })

  test('expenses on the 1st and last day of a month land in the same monthly bucket', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'First day', 10, { date: '2026-03-01' })
    await seedExpense(page, groupId, 'Last day', 20, { date: '2026-03-31' })
    await gotoApp(page, '/')

    // Both expenses roll up into the 2026-03 bucket: $30.00 all-time.
    await expect(page.getByTestId('analytics-all-time')).toContainText('$30.00')
    // The March bucket is present in the 12-month series and has a bar.
    await expect(page.getByTestId('month-2026-03')).toBeVisible()
    await expect(page.getByTestId('bar-2026-03')).toBeVisible()
  })
})
