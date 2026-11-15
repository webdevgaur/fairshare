import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'
import type { Page } from '@playwright/test'

/**
 * Call an API function in the page context. Throws a distinctive marker string
 * when the F12 function hasn't been implemented yet.
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

test.describe('F12 - Expense Dispute', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('creating a dispute does not change the original expense', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Verify original amount
    const expensesBefore = await callApi(page, 'getExpenses', [groupId])
    const original = expensesBefore.find((e: any) => e.uuid === expense.uuid)
    expect(original.amount).toBe(100)

    // Create a dispute with an alternative total
    await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Verify expense amount is unchanged
    const expensesAfter = await callApi(page, 'getExpenses', [groupId])
    const after = expensesAfter.find((e: any) => e.uuid === expense.uuid)
    expect(after.amount).toBe(100)
  })

  test('creating a dispute creates a pending dispute record', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Create dispute
    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Verify the dispute record
    expect(dispute.status).toBe('pending')
    expect(dispute.expense_uuid).toBe(expense.uuid)
    expect(dispute.proposed_total).toBe(80)
    expect(dispute.proposer_id).toBe(userId)
    expect(dispute.proposer_name).toBe('Alice')
    expect(dispute.acceptances).toEqual([])
    expect(dispute.rejections).toEqual([])

    // Verify via getPendingDisputes
    const pending = await callApi(page, 'getPendingDisputes', [groupId])
    expect(pending.length).toBeGreaterThanOrEqual(1)
    const found = pending.find((d: any) => d.uuid === dispute.uuid)
    expect(found).toBeTruthy()
    expect(found!.status).toBe('pending')
  })

  test('accepting a dispute by all members resolves it as accepted', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Charlie'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 150,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Create dispute
    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 120])

    // Get all member IDs and names from the dispute's acceptance_set
    const members = await callApi(page, 'getGroupMembers', [groupId])
    const memberIds = members.map((m: any) => m.id)
    const memberNames = members.map((m: any) => m.name)
    expect(memberIds.length).toBe(3)

    // Each member accepts via the API by switching identity
    for (let i = 0; i < memberIds.length; i++) {
      const mid = memberIds[i]
      const mname = memberNames[i]
      // Switch identity to this member
      await page.evaluate(
        ({ id, name }: { id: string; name: string }) => {
          localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
        },
        { id: mid, name: mname },
      )
      await callApi(page, 'acceptDispute', [dispute.uuid])
    }

    // Restore Alice's identity
    await page.evaluate(
      ({ id, name }: { id: string; name: string }) => {
        localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
      },
      { id: userId, name: 'Alice' },
    )

    // Verify dispute is no longer pending
    const pending = await callApi(page, 'getPendingDisputes', [groupId])
    const matchingPending = pending.filter((d: any) => d.uuid === dispute.uuid)
    expect(matchingPending.length).toBe(0)

    // Check dispute status via store
    const status = await page.evaluate(
      async ({ disputeUuid }: { disputeUuid: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        const d = storeMod.store.getDisputeByUuid(disputeUuid)
        return d ? { status: d.status, resolved_at: d.resolved_at } : null
      },
      { disputeUuid: dispute.uuid },
    )
    expect(status).not.toBeNull()
    expect(status!.status).toBe('accepted')
    expect(status!.resolved_at).toBeTruthy()
  })

  test('rejecting a dispute by any member resolves it as rejected', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Get members
    const members = await callApi(page, 'getGroupMembers', [groupId])
    const otherMember = members.find((m: any) => m.id !== userId)
    expect(otherMember).toBeTruthy()

    // The other member rejects
    await page.evaluate(
      async ({ disputeUuid, memberId }: { disputeUuid: string; memberId: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        storeMod.store.rejectDispute(disputeUuid, memberId)
      },
      { disputeUuid: dispute.uuid, memberId: otherMember!.id },
    )

    // Verify dispute is rejected
    const status = await page.evaluate(
      async ({ disputeUuid }: { disputeUuid: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        const d = storeMod.store.getDisputeByUuid(disputeUuid)
        return d ? { status: d.status, resolved_at: d.resolved_at } : null
      },
      { disputeUuid: dispute.uuid },
    )
    expect(status).not.toBeNull()
    expect(status!.status).toBe('rejected')
    expect(status!.resolved_at).toBeTruthy()
  })

  test('accepted dispute updates the expense amount', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Dispute with $80
    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Get members
    const members = await callApi(page, 'getGroupMembers', [groupId])
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
      await callApi(page, 'acceptDispute', [dispute.uuid])
    }

    // Restore identity
    await page.evaluate(
      ({ id, name }: { id: string; name: string }) => {
        localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
      },
      { id: userId, name: 'Alice' },
    )

    // Now verify expense amount is updated to $80
    const expensesAfter = await callApi(page, 'getExpenses', [groupId])
    const updated = expensesAfter.find((e: any) => e.uuid === expense.uuid)
    expect(updated.amount).toBe(80)
  })

  test('rejected dispute leaves the expense unchanged', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // A member rejects
    const members = await callApi(page, 'getGroupMembers', [groupId])
    const otherMember = members.find((m: any) => m.id !== userId)
    await page.evaluate(
      async ({ disputeUuid, memberId }: { disputeUuid: string; memberId: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        storeMod.store.rejectDispute(disputeUuid, memberId)
      },
      { disputeUuid: dispute.uuid, memberId: otherMember!.id },
    )

    // applyResolve for rejected
    await page.evaluate(
      async ({ disputeUuid }: { disputeUuid: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        storeMod.store.applyResolve(disputeUuid, 'rejected')
      },
      { disputeUuid: dispute.uuid },
    )

    // Verify expense is still $100
    const expensesAfter = await callApi(page, 'getExpenses', [groupId])
    const unchanged = expensesAfter.find((e: any) => e.uuid === expense.uuid)
    expect(unchanged.amount).toBe(100)
  })

  test('duplicate accept vote is idempotent', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Accept once via API
    const result1 = await callApi(page, 'acceptDispute', [dispute.uuid])
    expect(result1).not.toBeNull()

    // Accept again — should be idempotent (return null)
    const result2 = await callApi(page, 'acceptDispute', [dispute.uuid])
    expect(result2).toBeNull()

    // Verify only one acceptance counted
    const disputeState = await page.evaluate(
      async ({ disputeUuid }: { disputeUuid: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        const d = storeMod.store.getDisputeByUuid(disputeUuid)
        return d ? { acceptances: d.acceptances, rejections: d.rejections } : null
      },
      { disputeUuid: dispute.uuid },
    )
    expect(disputeState).not.toBeNull()
    expect(disputeState!.acceptances.length).toBe(1)
    expect(disputeState!.rejections.length).toBe(0)
  })

  test('creating a dispute logs a dispute_resolved activity entry on resolution', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    const dispute = await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Get members
    const members = await callApi(page, 'getGroupMembers', [groupId])
    const memberIds = members.map((m: any) => m.id)
    const memberNames = members.map((m: any) => m.name)

    // Each member accepts via API (which triggers applyResolve and logging on last accept)
    for (let i = 0; i < memberIds.length; i++) {
      await page.evaluate(
        ({ id, name }: { id: string; name: string }) => {
          localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
        },
        { id: memberIds[i], name: memberNames[i] },
      )
      await callApi(page, 'acceptDispute', [dispute.uuid])
    }

    // Restore identity
    await page.evaluate(
      ({ id, name }: { id: string; name: string }) => {
        localStorage.setItem('fairshare_identity', JSON.stringify({ id, name }))
      },
      { id: userId, name: 'Alice' },
    )

    // Check activity log for dispute_resolved entry
    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    const resolvedEntries = log.filter((e: any) => e.type === 'dispute_resolved')
    expect(resolvedEntries.length).toBeGreaterThanOrEqual(1)
    const resolved = resolvedEntries[resolvedEntries.length - 1]
    expect(resolved.entity_uuid).toBe(expense.uuid)
    expect(resolved.payload?.outcome).toBe('accepted')
  })

  test('cannot create two disputes on the same expense', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // First dispute should succeed
    await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Second dispute on same expense should throw
    let threw = false
    try {
      await callApi(page, 'createDispute', [groupId, expense.uuid, 60])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    // Verify only one dispute exists
    const pending = await callApi(page, 'getPendingDisputes', [groupId])
    const matching = pending.filter((d: any) => d.expense_uuid === expense.uuid)
    expect(matching.length).toBe(1)
  })

  test('cannot delete an expense with an open dispute', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Create a dispute on the expense
    await callApi(page, 'createDispute', [groupId, expense.uuid, 80])

    // Attempt to delete should be blocked
    let threw = false
    try {
      await callApi(page, 'deleteExpense', [groupId, expense.uuid])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    // Verify expense still exists
    const expenses = await callApi(page, 'getExpenses', [groupId])
    const found = expenses.find((e: any) => e.uuid === expense.uuid)
    expect(found).toBeTruthy()
    expect(found!.amount).toBe(100)
  })
})