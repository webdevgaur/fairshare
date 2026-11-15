import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'

test.describe('Expenses', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('add expense with equal split', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob', 'Charlie'])
    await gotoApp(page, `/groups/${groupId}`)

    await expect(page.getByText('No expenses yet')).toBeVisible()

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Pizza')
    await page.getByPlaceholder('Amount').first().fill('30')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(page.getByText('Pizza')).toBeVisible()
    await expect(page.getByText('$30.00').first()).toBeVisible()
  })

  test('add expense with custom split — per-person shares are preserved', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Utilities', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Electric Bill')
    await page.getByPlaceholder('Amount').first().fill('100')
    await page.getByRole('button', { name: 'Custom' }).click()

    // Custom split MUST show per-person amount inputs (placeholder "0.00" per member)
    const splitInputs = page.getByPlaceholder('0.00')
    await expect(splitInputs).toHaveCount(2)

    // Fill DIFFERENT amounts per person (not equal) — first input is Alice, second is Bob
    const splitInputsAll = await splitInputs.all()
    await splitInputsAll[0].fill('60')
    await splitInputsAll[1].fill('40')

    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Verify the expense card shows the custom split amounts
    await expect(page.getByText('Electric Bill')).toBeVisible()
    await expect(page.getByText('$100.00').first()).toBeVisible()
    await expect(page.getByText('$60.00').first()).toBeVisible()
    await expect(page.getByText('$40.00').first()).toBeVisible()

    // Verify Alice's split is $60, Bob's split is $40 (not equal $50/$50)
    await expect(page.getByText('$50.00')).toHaveCount(0)
  })

  test('view balances update after adding expense', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Road Trip', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Gas')
    await page.getByPlaceholder('Amount').first().fill('60')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Open balances accordion
    await page.getByText('Balances').click()
    await expect(page.getByText('Alice').first()).toBeVisible()
    await expect(page.getByText('Bob').first()).toBeVisible()
  })

  test('balances reflect custom split expense', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await page.getByPlaceholder('What for?').fill('Pizza')
    await page.getByPlaceholder('Amount').first().fill('100')
    await page.getByRole('button', { name: 'Custom' }).click()

    // Per-person inputs must appear for custom split
    const splitInputs = page.getByPlaceholder('0.00')
    await expect(splitInputs).toHaveCount(2)

    // Alice pays $100, split custom: Alice owes $20, Bob owes $80
    // Expected: Alice balance = +$100 - $20 = +$80, Bob balance = -$80
    const splitInputsAll = await splitInputs.all()
    await splitInputsAll[0].fill('20')
    await splitInputsAll[1].fill('80')

    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Open balances accordion
    await page.getByText('Balances').click()

    // Verify Alice is owed $80 (she paid $100, her share was $20)
    await expect(page.getByText('Alice')).toBeVisible()
    await expect(page.getByText('+$80.00')).toBeVisible()

    // Verify Bob owes $80
    await expect(page.getByText('Bob')).toBeVisible()
    await expect(page.getByText('-$80.00')).toBeVisible()
  })

  test('expense form shows on button click', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Snacks', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    // Form should be hidden initially
    await expect(page.getByPlaceholder('What for?')).not.toBeVisible()
    // Open form
    await page.getByRole('button', { name: '+ Add Expense' }).click()
    await expect(page.getByPlaceholder('What for?')).toBeVisible()
  })

  test('seeded expenses appear in the feed', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Office Lunch', '', ['Bob', 'Charlie'])
    await seedExpense(page, groupId, 'Sushi', 45)
    await gotoApp(page, `/groups/${groupId}`)

    await expect(page.getByText('Sushi')).toBeVisible()
    await expect(page.getByText('$45.00').first()).toBeVisible()
  })

  test('expense amount changes after dispute resolved', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense
    const expense = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createExpense({
        group_id: groupId,
        amount: 100,
        description: 'Dinner',
        splits: [],
      })
    }, { groupId })

    // Create dispute proposing $80
    const dispute = await page.evaluate(async ({ groupId, expense }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createDispute(groupId, expense.uuid, 80)
    }, { groupId, expense })

    // Get member IDs and names
    const members = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupMembers(groupId)
    }, { groupId })

    const memberIds = members.map((m: any) => m.id)
    const memberNames = members.map((m: any) => m.name)

    // All members accept via API by switching identity
    for (let i = 0; i < memberIds.length; i++) {
      await page.evaluate(
        ({ id, name }: { id: string; name: string }) => {
          localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
        },
        { id: memberIds[i], name: memberNames[i] },
      )
      await page.evaluate(async ({ disputeUuid }: any) => {
        const api: any = await import('/src/lib/api.ts')
        return api.acceptDispute(disputeUuid)
      }, { disputeUuid: dispute.uuid })
    }

    // Restore identity
    await page.evaluate(
      ({ id, name }: { id: string; name: string }) => {
        localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
      },
      { id: userId, name: 'Alice' },
    )

    // Verify expense amount updated to $80
    const expenses = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getExpenses(groupId)
    }, { groupId })

    const updated = expenses.find((e: any) => e.uuid === expense.uuid)
    expect(updated).toBeTruthy()
    expect(updated.amount).toBe(80)
  })
})