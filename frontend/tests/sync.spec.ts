import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'

test.describe('Sync Status Indicator', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows sync indicator in nav bar', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // Without a relay server, status is 'offline'
    await expect(page.getByTitle('Offline')).toBeVisible()
  })

  test('sync status shows "offline" without relay', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // The sync client initializes as 'offline' when no WebSocket relay is running
    await expect(page.getByTitle('Offline')).toBeVisible()
    // The text label (hidden on mobile) should show "offline"
    await expect(page.getByText('offline').first()).toBeVisible()
  })

  test('sync status shows in nav after creating a group', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // Create a group, which enqueues a sync operation
    await page.getByRole('button', { name: '+ New Group' }).click()
    await page.getByPlaceholder('Group name').fill('Sync Test Group')
    await page.getByRole('button', { name: 'Create' }).click()

    // Sync indicator should still be visible (either offline or queued)
    const offlineDot = page.getByTitle('Offline')
    const queuedDot = page.getByTitle('Changes queued')
    await expect(offlineDot.or(queuedDot)).toBeVisible()
  })
})

test.describe('CRDT Ops - create_activity', () => {
  test('create_activity op syncs and is idempotent', async ({ page }) => {
    await clearStorage(page)
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Count existing activity entries
    const beforeCount = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId).length
    }, { groupId })

    // Build a single op we'll apply twice
    const opId = 'test-op-' + crypto.randomUUID()
    const opData = {
      group_id: groupId,
      uuid: crypto.randomUUID(),
      type: 'expense_added',
      actor_id: userId,
      actor_name: 'Alice',
      entity_uuid: null,
      payload: { description: 'Synced expense', amount: 25 },
      created_at: new Date().toISOString(),
    }

    // Apply via syncClient.applyToStore (first time — entry should be created)
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'create_activity',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { opData, opId })

    // Verify the entry appears (count increases by 1)
    const afterFirst = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId)
    }, { groupId })
    expect(afterFirst.length).toBe(beforeCount + 1)
    const lastEntry = afterFirst[afterFirst.length - 1]
    expect(lastEntry.type).toBe('expense_added')
    expect(lastEntry.actor_id).toBe(userId)
    expect(lastEntry.actor_name).toBe('Alice')

    // Apply via applyRemoteOp (uses opLog for idempotency — same op_id → skip)
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'create_activity',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      // First applyRemoteOp — creates the entry (opLog.record is called inside)
      await (sc as any).applyRemoteOp(op)
      // Second applyRemoteOp with same op_id — should be skipped (opLog.has check)
      await (sc as any).applyRemoteOp(op)
    }, { opData, opId })

    // Count after all applies — should still be afterFirst + 1 (no duplicate)
    const afterSecond = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId)
    }, { groupId })
    expect(afterSecond.length).toBe(afterFirst.length)
    // Verify the last entry still matches (not a duplicate)
    const lastAfter = afterSecond[afterSecond.length - 1]
    expect(lastAfter.uuid).toBe(lastEntry.uuid)
  })
})

test.describe('CRDT Ops - delete_expense', () => {
  test('delete_expense op syncs and is idempotent', async ({ page }) => {
    await clearStorage(page)
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense via the real API
    const expense = await page.evaluate(async ({ groupId, userId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createExpense({
        group_id: groupId,
        amount: 50,
        description: 'Synced Dinner',
        splits: [{ user_id: userId }],
      })
    }, { groupId, userId })

    // Get baseline: expense count and activity count
    const expensesBefore = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getExpenses(groupId)
    }, { groupId })
    expect(expensesBefore.length).toBe(1)

    const activityBefore = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId)
    }, { groupId })

    // Build the delete_expense op that will simulate a remote CRDT operation
    const opId = 'delete-test-op-' + crypto.randomUUID()
    const opData = {
      group_id: groupId,
      expenseUuid: expense.uuid,
      actor_id: userId,
      actor_name: 'Alice',
      created_at: new Date().toISOString(),
    }

    // Apply via applyToStore (mimicking a sync'd delete_expense from another device)
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'delete_expense',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { opData, opId })

    // Verify: expense is now soft-deleted (getExpenses filters it out)
    const expensesAfterFirst = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getExpenses(groupId)
    }, { groupId })
    expect(expensesAfterFirst.length).toBe(0)

    // Activity log should have gained exactly one expense_deleted entry
    const activityAfterFirst = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId)
    }, { groupId })
    const deletedEntriesFirst = activityAfterFirst.filter((e: any) => e.type === 'expense_deleted')
    expect(deletedEntriesFirst.length).toBe(1)
    expect(deletedEntriesFirst[0].entity_uuid).toBe(expense.uuid)

    // Apply the SAME op again via applyRemoteOp — should be idempotent
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'delete_expense',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      // applyRemoteOp records in opLog → second call with same op_id should be skipped
      await (sc as any).applyRemoteOp(op)
      await (sc as any).applyRemoteOp(op)
    }, { opData, opId })

    // Verify no duplicate activity entry
    const activityAfterSecond = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getGroupActivityLog(groupId)
    }, { groupId })
    const deletedEntriesSecond = activityAfterSecond.filter((e: any) => e.type === 'expense_deleted')
    expect(deletedEntriesSecond.length).toBe(1)

    // Verify expense is still gone
    const expensesAfterSecond = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getExpenses(groupId)
    }, { groupId })
    expect(expensesAfterSecond.length).toBe(0)
  })
})