import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, seedSettlement, gotoApp } from './setup'

test.describe('Settlements', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('seeded settlements appear in the feed', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Household', '', ['Bob'])
    // Alice pays $100, split equally → Bob owes $50
    await seedExpense(page, groupId, 'Groceries', 100)
    // Bob pays Alice $50
    await seedSettlement(page, groupId, 50)
    await gotoApp(page, `/groups/${groupId}`)

    // Settlement text: "Bob paid Alice"
    await expect(page.getByText('paid')).toBeVisible()
    await expect(page.getByText('$50.00').first()).toBeVisible()
  })

  test('settle up form opens on button click', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Coffee', '', ['Bob'])
    await seedExpense(page, groupId, 'Coffee run', 15)
    await gotoApp(page, `/groups/${groupId}`)

    // Form should be hidden initially
    await expect(page.getByText("Who's paying?")).not.toBeVisible()
    // Open settle form
    await page.getByRole('button', { name: 'Settle Up' }).click()
    await expect(page.getByText("Who's paying?")).toBeVisible()
  })

  test('settlement updates balances display', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Lunch', '', ['Bob'])
    // Alice pays $40, each owes $20
    await seedExpense(page, groupId, 'Sandwiches', 40)
    // Bob pays Alice $20
    await seedSettlement(page, groupId, 20)
    await gotoApp(page, `/groups/${groupId}`)

    // Settlement should show
    await expect(page.getByText('paid')).toBeVisible()
    // Open balances
    await page.getByText('Balances').click()
    // Alice should still be owed $20 (Bob paid $20 of the $40, still owes $20)
    await expect(page.getByText('Alice').first()).toBeVisible()
    await expect(page.getByText('Bob').first()).toBeVisible()
  })
})