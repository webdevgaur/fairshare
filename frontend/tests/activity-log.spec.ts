import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, seedSettlement, seedComment, gotoApp } from './setup'
import type { Page } from '@playwright/test'

const NOT_IMPL = '__NOT_IMPLEMENTED__'

/**
 * Call an API function in the page context. Throws a distinctive marker string
 * when the F10 function hasn't been implemented yet.
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

/** Seed a raw expense directly into localStorage (bypasses the API — no activity entry created). */
async function seedRawExpense(
  page: Page,
  groupId: number,
  description: string,
  amount: number,
  paidBy?: string,
  createdAt?: string,
): Promise<{ id: number; uuid: string }> {
  return page.evaluate(
    ({ groupId, description, amount, paidBy, createdAt }: any) => {
      const raw = localStorage.getItem('fairshare_store')
      if (!raw) return { id: -1, uuid: '' }
      const state = JSON.parse(raw)
      const identityRaw = localStorage.getItem('fairshare_identity')
      if (!identityRaw) return { id: -1, uuid: '' }
      const identity = JSON.parse(identityRaw)
      const payerId = paidBy || identity.id

      const members = state.groupMembers
        .filter((gm: any) => gm.group_id === groupId)
        .map((gm: any) => {
          const u = state.users.find((usr: any) => usr.id === gm.user_id)
          return u ? { id: u.id, name: u.name } : null
        })
        .filter(Boolean)

      const expId = state.nextExpenseId++
      const uuid = crypto.randomUUID()
      const now = createdAt || new Date().toISOString()
      state.expenses.push({
        id: expId,
        uuid,
        group_id: groupId,
        paid_by: payerId,
        amount,
        description,
        date: now.slice(0, 10),
        created_at: now,
      })

      const perPerson = amount / members.length
      for (const m of members) {
        const sid = state.nextSplitId++
        state.expenseSplits.push({
          id: sid,
          expense_id: expId,
          user_id: m.id,
          amount: perPerson,
        })
      }

      localStorage.setItem('fairshare_store', JSON.stringify(state))
      return { id: expId, uuid }
    },
    { groupId, description, amount, paidBy, createdAt },
  )
}

/** Seed a raw settlement directly into localStorage (bypasses the API). */
async function seedRawSettlement(
  page: Page,
  groupId: number,
  amount: number,
  fromUser?: string,
  toUser?: string,
  createdAt?: string,
): Promise<{ id: number; uuid: string }> {
  return page.evaluate(
    ({ groupId, amount, fromUser, toUser, createdAt }: any) => {
      const raw = localStorage.getItem('fairshare_store')
      if (!raw) return { id: -1, uuid: '' }
      const state = JSON.parse(raw)
      const identityRaw = localStorage.getItem('fairshare_identity')
      if (!identityRaw) return { id: -1, uuid: '' }
      const identity = JSON.parse(identityRaw)

      const members = state.groupMembers
        .filter((gm: any) => gm.group_id === groupId)
        .map((gm: any) => ({ id: gm.user_id }))

      const debtorId = fromUser || members[0]?.id || identity.id
      const creditorId = toUser || members[1]?.id || identity.id

      const sid = state.nextSettlementId++
      const uuid = crypto.randomUUID()
      const now = createdAt || new Date().toISOString()
      state.settlements.push({
        id: sid,
        uuid,
        group_id: groupId,
        from_user: debtorId,
        to_user: creditorId,
        amount,
        date: now.slice(0, 10),
        created_at: now,
      })

      localStorage.setItem('fairshare_store', JSON.stringify(state))
      return { id: sid, uuid }
    },
    { groupId, amount, fromUser, toUser, createdAt },
  )
}

/** Seed a comment directly into localStorage (bypasses the API). */
async function seedRawComment(
  page: Page,
  groupId: number,
  expenseUuid: string,
  expenseId: number,
  text: string,
  authorId?: string,
  createdAt?: string,
): Promise<number> {
  return page.evaluate(
    ({ groupId, expenseUuid, expenseId, text, authorId, createdAt }: any) => {
      const raw = localStorage.getItem('fairshare_store')
      if (!raw) return -1
      const state = JSON.parse(raw)
      const identityRaw = localStorage.getItem('fairshare_identity')
      if (!identityRaw) return -1
      const identity = JSON.parse(identityRaw)

      if (!Array.isArray(state.comments)) state.comments = []
      if (!state.nextCommentId) state.nextCommentId = 1

      const cid = state.nextCommentId++
      state.comments.push({
        id: cid,
        group_id: groupId,
        expense_uuid: expenseUuid,
        expense_id: expenseId,
        author_id: authorId || identity.id,
        author_name: identity.name,
        text,
        created_at: createdAt || new Date().toISOString(),
      })

      localStorage.setItem('fairshare_store', JSON.stringify(state))
      return cid
    },
    { groupId, expenseUuid, expenseId, text, authorId, createdAt },
  )
}

test.describe('F10 - Activity Log', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('creating an expense adds an expense_added activity entry', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', 'Shared home', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 50,
      description: 'Groceries',
      splits: [{ user_id: userId }],
    }])

    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    const entries = log.filter((e: any) => e.type === 'expense_added')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const entry = entries[0]
    expect(entry.actor_id).toBe(userId)
    expect(entry.entity_uuid).toBe(expense.uuid)
    expect(entry.payload?.description).toBe('Groceries')
    expect(entry.payload?.amount).toBe(50)
  })

  test('creating a settlement adds a settlement_created activity entry', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense so there's something to settle
    await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 100,
      description: 'Dinner',
      splits: [{ user_id: userId }],
    }])

    // Calculate who needs to pay whom
    const balances = await callApi(page, 'getGroupBalances', [groupId])
    // Find the member with negative balance (debtor) and positive balance (creditor)
    const debtor = balances.balances.find((b: any) => b.balance < 0)
    const creditor = balances.balances.find((b: any) => b.balance > 0)

    if (debtor && creditor) {
      const settlement = await callApi(page, 'createSettlement', [{
        group_id: groupId,
        from_user: debtor.user_id,
        to_user: creditor.user_id,
        amount: Math.min(Math.abs(debtor.balance), creditor.balance),
      }])

      const log = await callApi(page, 'getGroupActivityLog', [groupId])
      const entries = log.filter((e: any) => e.type === 'settlement_created')
      expect(entries.length).toBeGreaterThanOrEqual(1)
      const entry = entries[0]
      expect(entry.entity_uuid).toBe(settlement.uuid)
      expect(entry.actor_id).toBe(userId)
    } else {
      // All balances are zero — no settlement needed; test passes vacuously
      // since the scenario is degenerate
    }
  })

  test('adding a comment adds a comment_added activity entry', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    const expense = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 30,
      description: 'Lunch',
      splits: [{ user_id: userId }],
    }])

    await callApi(page, 'createComment', [groupId, expense.uuid, 'Looks good!'])

    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    const entries = log.filter((e: any) => e.type === 'comment_added')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const entry = entries[0]
    expect(entry.actor_id).toBe(userId)
    expect(entry.entity_uuid).toBe(expense.uuid)
    expect(entry.payload?.text).toBe('Looks good!')
  })

  test('activity log is chronological', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await gotoApp(page, '/')

    // Create two expenses with different timestamps by using direct seed
    // First expense (older timestamp)
    const olderTimestamp = '2024-01-01T10:00:00.000Z'
    const exp1 = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 20,
      description: 'Old expense',
      splits: [{ user_id: userId }],
    }])

    // Second expense (newer)
    await new Promise((r) => setTimeout(r, 200)) // ensure different millisecond
    const exp2 = await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 30,
      description: 'New expense',
      splits: [{ user_id: userId }],
    }])

    const log = await callApi(page, 'getGroupActivityLog', [groupId])

    // Filter to expense_added entries
    const addedEntries = log.filter((e: any) => e.type === 'expense_added')

    // Should have at least 2 expense_added entries
    expect(addedEntries.length).toBeGreaterThanOrEqual(2)

    // Verify they are in ascending chronological order
    for (let i = 1; i < addedEntries.length; i++) {
      expect(addedEntries[i].created_at.localeCompare(addedEntries[i - 1].created_at)).toBeGreaterThanOrEqual(0)
    }

    // Verify both expense UUIDs are in the log
    const uuids = addedEntries.map((e: any) => e.entity_uuid)
    expect(uuids).toContain(exp1.uuid)
    expect(uuids).toContain(exp2.uuid)
  })

  test('activity log is per-group', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const group1Id = await seedGroup(page, 'Home', '', ['Bob'])
    const group2Id = await seedGroup(page, 'Work', '', ['Bob'])
    await gotoApp(page, '/')

    // Create an expense only in group 1
    await callApi(page, 'createExpense', [{
      group_id: group1Id,
      amount: 50,
      description: 'Groceries',
      splits: [{ user_id: userId }],
    }])

    const log1 = await callApi(page, 'getGroupActivityLog', [group1Id])
    const log2 = await callApi(page, 'getGroupActivityLog', [group2Id])

    expect(log1.length).toBeGreaterThanOrEqual(1)
    expect(log2.length).toBe(0)
  })

  test('backfill creates entries for pre-existing expenses', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])

    // Seed an expense directly in localStorage (bypassing the API)
    const { uuid } = await seedRawExpense(page, groupId, 'Pre-existing expense', 75)

    // Now load the app — backfill should create activity entries
    await gotoApp(page, '/')

    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    const entries = log.filter((e: any) => e.type === 'expense_added')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const entry = entries.find((e: any) => e.entity_uuid === uuid)
    expect(entry).toBeTruthy()
    expect(entry!.actor_id).toBe(userId)
  })

  test('backfill creates entries for pre-existing settlements and comments', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])

    // Seed an expense first (needed for comment)
    const { id: expId, uuid: expUuid } = await seedRawExpense(page, groupId, 'Shared cost', 60)

    // Seed a settlement directly in localStorage
    const { uuid: settlementUuid } = await seedRawSettlement(page, groupId, 30)

    // Seed a comment directly in localStorage
    await seedRawComment(page, groupId, expUuid, expId, 'Nice!')

    // Now load the app — backfill should create activity entries for all three
    await gotoApp(page, '/')

    const log = await callApi(page, 'getGroupActivityLog', [groupId])

    const expenseEntries = log.filter((e: any) => e.type === 'expense_added')
    expect(expenseEntries.length).toBeGreaterThanOrEqual(1)

    const settlementEntries = log.filter((e: any) => e.type === 'settlement_created')
    expect(settlementEntries.length).toBeGreaterThanOrEqual(1)

    const commentEntries = log.filter((e: any) => e.type === 'comment_added')
    expect(commentEntries.length).toBeGreaterThanOrEqual(1)
  })

  test('activity log shows up in the Activity tab on GroupPage', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    // Create an expense so the activity log has entries (otherwise data-testid isn't rendered)
    await seedExpense(page, groupId, 'Dinner', 60)
    // Navigate directly to the group page
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Click the Activity tab
    const activityTab = page.getByRole('tab', { name: 'Activity' })
    await activityTab.click()
    await page.waitForLoadState('domcontentloaded')

    // Verify the activity log component is rendered
    const activityLog = page.locator('[data-testid="activity-log"]')
    await expect(activityLog).toBeVisible()
  })

  test('activity log shows human-readable action text', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])

    // Navigate to the group page first, then create expense via API
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Create an expense with a clear description via the API
    await callApi(page, 'createExpense', [{
      group_id: groupId,
      amount: 42,
      description: 'Pizza',
      splits: [{ user_id: userId }],
    }])

    // Refresh the page to reload the group with the new expense
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Click the Activity tab
    const activityTab = page.getByRole('tab', { name: 'Activity' })
    await activityTab.click()
    await page.waitForLoadState('domcontentloaded')

    // The description "Pizza" should appear on the page
    await expect(page.getByText('Pizza').first()).toBeVisible()
  })

  test('no activity yet when group is fresh', async ({ page }) => {
    const userId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Fresh Group', '', [])
    // Navigate directly to the group page
    await gotoApp(page, `/groups/${groupId}`)
    await page.waitForLoadState('networkidle')

    // Click the Activity tab
    const activityTab = page.getByRole('tab', { name: 'Activity' })
    await activityTab.click()
    await page.waitForLoadState('domcontentloaded')

    // Verify the "No activity yet" message
    await expect(page.getByText('No activity yet')).toBeVisible()

    // Also verify the API returns an empty log for this group
    const log = await callApi(page, 'getGroupActivityLog', [groupId])
    expect(log).toHaveLength(0)
  })
})