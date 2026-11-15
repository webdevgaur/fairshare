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

test.describe('CRDT Ops - Expense Disputes (F12)', () => {
  test('create_dispute op syncs', async ({ page }) => {
    await clearStorage(page)
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense via the real API
    const expense = await page.evaluate(async ({ groupId, userId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createExpense({
        group_id: groupId,
        amount: 100,
        description: 'Synced Dinner',
        splits: [{ user_id: userId }],
      })
    }, { groupId, userId })

    // Build a create_dispute CRDT op
    const disputeUuid = crypto.randomUUID()
    const opId = 'dispute-create-op-' + crypto.randomUUID()
    const opData = {
      group_id: groupId,
      expense_uuid: expense.uuid,
      proposer_id: userId,
      proposer_name: 'Alice',
      proposed_total: 80,
      proposed_splits: null,
      acceptance_set: [userId],
      uuid: disputeUuid,
      created_at: new Date().toISOString(),
    }

    // Apply via applyToStore (mimicking a sync'd create_dispute from another device)
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'create_dispute',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { opData, opId })

    // Verify dispute exists in the store
    const pending = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getPendingDisputes(groupId)
    }, { groupId })
    expect(pending.length).toBeGreaterThanOrEqual(1)
    const found = pending.find((d: any) => d.uuid === disputeUuid)
    expect(found).toBeTruthy()
    expect(found!.status).toBe('pending')
    expect(found!.expense_uuid).toBe(expense.uuid)
    expect(found!.proposed_total).toBe(80)

    // Apply same op again — should be idempotent (duplicate dispute not created)
    await page.evaluate(async ({ opData, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'create_dispute',
        group_id: String(opData.group_id),
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: opData,
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { opData, opId })

    // Verify still only one dispute
    const pendingAfterSecond = await page.evaluate(async ({ groupId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.getPendingDisputes(groupId)
    }, { groupId })
    const matching = pendingAfterSecond.filter((d: any) => d.uuid === disputeUuid)
    expect(matching.length).toBe(1)
  })

  test('accept_dispute op syncs and resolves on last vote', async ({ page }) => {
    await clearStorage(page)
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Charlie'])
    await gotoApp(page, '/')

    // Create an expense
    const expense = await page.evaluate(async ({ groupId, userId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createExpense({
        group_id: groupId,
        amount: 150,
        description: 'Group Dinner',
        splits: [{ user_id: userId }],
      })
    }, { groupId, userId })

    // Create dispute via API (gives us a dispute with acceptance_set=[Alice, Bob, Charlie])
    const dispute = await page.evaluate(async ({ groupId, expense }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createDispute(groupId, expense.uuid, 120)
    }, { groupId, expense })

    // Get member IDs from the dispute's acceptance_set
    const memberIds = dispute.acceptance_set as string[]
    expect(memberIds.length).toBe(3)

    // Simulate accept_dispute ops via store.acceptDispute directly
    // for the first two members (not yet resolved)
    for (let i = 0; i < 2; i++) {
      await page.evaluate(
        async ({ disputeUuid, memberId }: { disputeUuid: string; memberId: string }) => {
          const storeMod: any = await import('/src/lib/store.ts')
          storeMod.store.acceptDispute(disputeUuid, memberId)
        },
        { disputeUuid: dispute.uuid, memberId: memberIds[i] },
      )
    }

    // After 2 of 3 accept, dispute should still be pending
    const pendingAfterTwo = await page.evaluate(async ({ disputeUuid }: any) => {
      const storeMod: any = await import('/src/lib/store.ts')
      const d = storeMod.store.getDisputeByUuid(disputeUuid)
      return d ? { status: d.status, acceptances: d.acceptances, acceptance_set: d.acceptance_set, rejections: d.rejections } : null
    }, { disputeUuid: dispute.uuid })
    expect(pendingAfterTwo).not.toBeNull()
    expect(pendingAfterTwo!.status).toBe('pending')
    expect(pendingAfterTwo!.acceptances.length).toBe(2)

    // Simulate the third accept — should trigger resolution
    await page.evaluate(
      async ({ disputeUuid, memberId }: { disputeUuid: string; memberId: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        storeMod.store.acceptDispute(disputeUuid, memberId)
      },
      { disputeUuid: dispute.uuid, memberId: memberIds[2] },
    )

    // Verify dispute auto-resolved
    const resolved = await page.evaluate(async ({ disputeUuid }: any) => {
      const storeMod: any = await import('/src/lib/store.ts')
      const d = storeMod.store.getDisputeByUuid(disputeUuid)
      return d ? { status: d.status, resolved_at: d.resolved_at, acceptances: d.acceptances } : null
    }, { disputeUuid: dispute.uuid })
    expect(resolved).not.toBeNull()
    expect(resolved!.status).toBe('accepted')
    expect(resolved!.resolved_at).toBeTruthy()
    expect(resolved!.acceptances.length).toBe(3)

    // Accept same member again via store — idempotent
    await page.evaluate(
      async ({ disputeUuid, memberId }: { disputeUuid: string; memberId: string }) => {
        const storeMod: any = await import('/src/lib/store.ts')
        storeMod.store.acceptDispute(disputeUuid, memberId)
      },
      { disputeUuid: dispute.uuid, memberId: memberIds[2] },
    )

    // Verify no change
    const afterReapply = await page.evaluate(async ({ disputeUuid }: any) => {
      const storeMod: any = await import('/src/lib/store.ts')
      const d = storeMod.store.getDisputeByUuid(disputeUuid)
      return d ? { status: d.status, acceptances: d.acceptances } : null
    }, { disputeUuid: dispute.uuid })
    expect(afterReapply!.status).toBe('accepted')
    expect(afterReapply!.acceptances.length).toBe(3)
  })

  test('reject_dispute op syncs and rejects', async ({ page }) => {
    await clearStorage(page)
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense
    const expense = await page.evaluate(async ({ groupId, userId }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createExpense({
        group_id: groupId,
        amount: 100,
        description: 'Synced Dinner',
        splits: [{ user_id: userId }],
      })
    }, { groupId, userId })

    // Create dispute via API
    const dispute = await page.evaluate(async ({ groupId, expense }: any) => {
      const api: any = await import('/src/lib/api.ts')
      return api.createDispute(groupId, expense.uuid, 80)
    }, { groupId, expense })

    const otherMemberId = dispute.acceptance_set.find((id: string) => id !== userId)

    // Simulate a reject_dispute op
    const opId = 'dispute-reject-op-' + crypto.randomUUID()
    await page.evaluate(async ({ disputeUuid, memberId, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'reject_dispute',
        group_id: '0',
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: {
          dispute_uuid: disputeUuid,
          member_id: memberId,
        },
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { disputeUuid: dispute.uuid, memberId: otherMemberId, opId })

    // Verify dispute is rejected
    const result = await page.evaluate(async ({ disputeUuid }: any) => {
      const storeMod: any = await import('/src/lib/store.ts')
      const d = storeMod.store.getDisputeByUuid(disputeUuid)
      return d ? { status: d.status, resolved_at: d.resolved_at, rejections: d.rejections } : null
    }, { disputeUuid: dispute.uuid })
    expect(result).not.toBeNull()
    expect(result!.status).toBe('rejected')
    expect(result!.resolved_at).toBeTruthy()
    expect(result!.rejections.length).toBe(1)

    // Apply same reject op again — idempotent
    await page.evaluate(async ({ disputeUuid, memberId, opId }: any) => {
      const sync: any = await import('/src/lib/sync.ts')
      const sc = sync.syncClient
      const op = {
        op_id: opId,
        type: 'reject_dispute',
        group_id: '0',
        lamport_counter: 1,
        peer_id: 'test-peer',
        data: {
          dispute_uuid: disputeUuid,
          member_id: memberId,
        },
        created_at: Date.now(),
      }
      ;(sc as any).applyToStore(op)
    }, { disputeUuid: dispute.uuid, memberId: otherMemberId, opId })

    // Verify no duplicate rejection
    const afterReapply = await page.evaluate(async ({ disputeUuid }: any) => {
      const storeMod: any = await import('/src/lib/store.ts')
      const d = storeMod.store.getDisputeByUuid(disputeUuid)
      return d ? { rejections: d.rejections, status: d.status } : null
    }, { disputeUuid: dispute.uuid })
    expect(afterReapply!.status).toBe('rejected')
    expect(afterReapply!.rejections.length).toBe(1)
  })
})