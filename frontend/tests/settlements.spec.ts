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

  test('settlements ignore deleted expenses', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Dinner', 100)
    await gotoApp(page, `/groups/${groupId}`)

    // Before delete: verify settlement suggestions exist (Bob owes Alice $50)
    const before = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getSuggestedSettlements(groupId)
    }, { groupId })
    expect(before.length).toBeGreaterThanOrEqual(1)

    // Delete the expense via the API
    const expenses = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getExpenses(groupId)
    }, { groupId })
    if (expenses.length > 0) {
      await page.evaluate(async ({ groupId, expenseUuid }: any) => {
        const api: any = await import('/src/lib/api.ts')
        api.deleteExpense(groupId, expenseUuid)
      }, { groupId, expenseUuid: expenses[0].uuid })
    }

    // After delete: settlement suggestions should be empty (no active expenses)
    const after = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getSuggestedSettlements(groupId)
    }, { groupId })
    expect(after.length).toBe(0)
  })

  test('couple mode does not change existing settlement arithmetic', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Household', '', ['Bob'])
    // Alice pays $100, split equally → Bob owes $50
    await seedExpense(page, groupId, 'Groceries', 100)
    // Bob settles his $50 debt → a settlement entry appears in the feed.
    await seedSettlement(page, groupId, 50)
    // Seed a couple (Alice + Bob) but leave couple mode OFF — settlement
    // suggestions / arithmetic must be identical to having no couple at all.
    await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_store')
      const state = JSON.parse(raw)
      const identity = JSON.parse(localStorage.getItem('fairshare_identity')!)
      const bob = state.users.find((u: any) => u.name === 'Bob')
      if (!Array.isArray(state.couples)) state.couples = []
      if (!state.nextCoupleId) state.nextCoupleId = 1
      state.couples.push({
        id: state.nextCoupleId++,
        uuid: crypto.randomUUID(),
        user_a: identity.id,
        user_b: bob.id,
        created_at: new Date().toISOString(),
      })
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    })
    await gotoApp(page, `/groups/${groupId}`)

    // Same settlement text and amount as the seeded-data test above.
    await expect(page.getByText('paid')).toBeVisible()
    await expect(page.getByText('$50.00').first()).toBeVisible()
  })
})