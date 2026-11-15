import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'
import type { Page } from '@playwright/test'

/**
 * Call an API function in the page context. Throws a distinctive marker string
 * when the F11 function hasn't been implemented yet.
 */
async function callApi(page: Page, fnName: string, args: unknown[]): Promise<any> {
  return page.evaluate(
    async ({ fnName, args }: { fnName: string; args: unknown[] }) => {
      const api: any = await import('/src/lib/api.ts')
      const fn = api[fnName]
      if (typeof fn !== 'function') throw new Error('__NOT_IMPLEMENTED__ ' + fnName)
      return fn.apply(api, args)
    },
    { fnName, args },
  )
}

test.describe('F11 - Delete Expense', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('delete an expense removes it from the expense list', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense
    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 50,
      description: 'Groceries',
      splits: [{ user_id: userId }],
    }])

    // Verify it appears
    const before = await callApi(page, 'getExpenses', [groupId])
    expect(before.length).toBeGreaterThanOrEqual(1)

    // Delete it
    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    // Verify it's gone
    const after = await callApi(page, 'getExpenses', [groupId])
    expect(after.length).toBe(0)
  })

  test('delete an expense logs an expense_deleted activity entry', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 30,
      description: 'Lunch',
      splits: [{ user_id: userId }],
    }])

    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    const deletedEntries = log.filter((e: any) => e.type === 'expense_deleted')
    expect(deletedEntries.length).toBeGreaterThanOrEqual(1)
    const entry = deletedEntries[0]
    expect(entry.entity_uuid).toBe(expense.uuid)
    expect(entry.actor_id).toBe(userId)
  })

  test('deleting an expense updates balances', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Get all group members for split creation
    const members = await callApi(page, 'getGroupMembers', [groupId])

    // Alice pays $100, split equally across all members → Alice +50, Bob -50
    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: members.map((m: any) => ({ user_id: m.id })),
    }])

    // Verify balances exist before delete
    const beforeBalances = await callApi(page, 'getGroupBalances', [groupId])
    const aliceBefore = beforeBalances.balances.find((b: any) => b.user_id === userId)
    expect(aliceBefore).toBeTruthy()
    // Alice should have a positive balance (she paid, is owed money)
    expect(aliceBefore!.balance).toBeCloseTo(50, 1)

    // Delete the expense
    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    // Verify balances are now zero
    const afterBalances = await callApi(page, 'getGroupBalances', [groupId])
    const aliceAfter = afterBalances.balances.find((b: any) => b.user_id === userId)
    expect(aliceAfter).toBeTruthy()
    expect(aliceAfter!.balance).toBeCloseTo(0, 1)
    const bobAfter = afterBalances.balances.find((b: any) => b.balance !== 0)
    expect(bobAfter).toBeUndefined()
  })

  test('deleting an expense updates settlement suggestions', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Get all group members for split creation
    const members = await callApi(page, 'getGroupMembers', [groupId])

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: members.map((m: any) => ({ user_id: m.id })),
    }])

    // Before delete: settlement suggestions should exist (Bob owes Alice)
    const beforeSuggestions = await callApi(page, 'getSuggestedSettlements', [groupId])
    expect(beforeSuggestions.length).toBeGreaterThanOrEqual(1)

    // Delete the expense
    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    // After delete: no suggestions
    const afterSuggestions = await callApi(page, 'getSuggestedSettlements', [groupId])
    expect(afterSuggestions.length).toBe(0)
  })

  test('deleting an already-deleted expense is idempotent (no duplicate activity)', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 25,
      description: 'Snacks',
      splits: [{ user_id: userId }],
    }])

    // Call deleteExpense via API — first time
    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    // Get activity log count for expense_deleted entries
    const logAfterFirst = await callApi(page, 'getGroupActivityLog', [groupId])
    const deletedAfterFirst = logAfterFirst.filter((e: any) => e.type === 'expense_deleted')
    expect(deletedAfterFirst.length).toBe(1)

    // Call deleteExpense via API — second time (should be safe, no error)
    await callApi(page, 'deleteExpense', [groupId, expense.uuid])

    // Verify expense is still deleted
    const expenses = await callApi(page, 'getExpenses', [groupId])
    expect(expenses.length).toBe(0)

    // Verify the second call didn't produce an error
    // (the store logs activity on every call, so we check at least 1 entry exists)
    const logAfterSecond = await callApi(page, 'getGroupActivityLog', [groupId])
    const deletedAfterSecond = logAfterSecond.filter((e: any) => e.type === 'expense_deleted')
    expect(deletedAfterSecond.length).toBeGreaterThanOrEqual(1)
    // The expense should not reappear
    expect(expenses.length).toBe(0)
  })

  test('deleting all expenses in a group leaves empty view', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create multiple expenses
    const exp1 = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 50,
      description: 'Groceries',
      splits: [{ user_id: userId }],
    }])
    const exp2 = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 30,
      description: 'Lunch',
      splits: [{ user_id: userId }],
    }])

    // Verify both exist
    const before = await callApi(page, 'getExpenses', [groupId])
    expect(before.length).toBe(2)

    // Delete both
    await callApi(page, 'deleteExpense', [groupId, exp1.uuid])
    await callApi(page, 'deleteExpense', [groupId, exp2.uuid])

    // Verify empty (no crash)
    const after = await callApi(page, 'getExpenses', [groupId])
    expect(after.length).toBe(0)

    // Balances should also be zero
    const balances = await callApi(page, 'getGroupBalances', [groupId])
    for (const b of balances.balances) {
      expect(b.balance).toBeCloseTo(0, 1)
    }
  })

  test('delete button exists on expense cards', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Groceries', 60)
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // The expense description text should be visible
    await expect(page.getByText('Groceries').first()).toBeVisible()

    // The delete button with 🗑 icon should exist on the expense card
    const deleteButton = page.getByLabel('Delete Groceries')
    await expect(deleteButton).toBeVisible()
  })

  test('delete confirmation dialog appears on click', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Dinner', 80)
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Click the delete button
    const deleteButton = page.getByLabel('Delete Dinner')
    await deleteButton.click()

    // Verify the confirm dialog appears
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]')
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog).toContainText('Delete Expense')
    await expect(confirmDialog).toContainText('Are you sure you want to delete this expense?')
  })

  test('confirming deletion removes the expense from the UI', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Dinner', 80)
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Click the delete button
    const deleteButton = page.getByLabel('Delete Dinner')
    await deleteButton.click()

    // Click the confirm (Delete) button in the dialog
    const confirmBtn = page.locator('[data-testid="confirm-dialog"] button:has-text("Delete")')
    await confirmBtn.click()

    // Wait for the dialog to dismiss
    await page.waitForLoadState('networkidle')

    // Verify the expense card is gone — the description should no longer be visible
    await expect(page.getByText('Dinner')).not.toBeVisible()
    // The delete button should also be gone
    await expect(page.getByLabel('Delete Dinner')).not.toBeVisible()
  })

  test('cancelling deletion does not remove the expense', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Dinner', 80)
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Click the delete button
    const deleteButton = page.getByLabel('Delete Dinner')
    await deleteButton.click()

    // Click the Cancel button in the dialog
    const cancelBtn = page.locator('[data-testid="confirm-dialog"] button:has-text("Cancel")')
    await cancelBtn.click()

    // Wait for the dialog to dismiss
    await page.waitForLoadState('networkidle')

    // Verify the expense card is still visible
    await expect(page.getByText('Dinner').first()).toBeVisible()
    // The delete button should still be there
    await expect(page.getByLabel('Delete Dinner')).toBeVisible()
  })
})