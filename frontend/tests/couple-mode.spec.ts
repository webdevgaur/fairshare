import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'
import type { Page } from '@playwright/test'

/**
 * F9 — Couple Mode E2E tests.
 *
 * These drive the real application through the intended `src/lib/api.ts` /
 * `src/lib/engine.ts` surface (loaded via dynamic `import()` in the Vite dev
 * page context, which resolves to the app's already-instantiated module graph
 * so it reads the same in-memory store the UI uses).
 *
 * NOTE: F9 is implemented as a *post-processing* netting step over
 * `calculateBalances`. These tests assert the externally-observable behaviour:
 *   - `registerCouple` / `getCoupleForUser` ?? registration rules
 *   - a per-group `setGroupCoupleMode` / `getGroupCoupleMode` toggle
 *   - `getSuggestedSettlements` netting couples when the group toggle is ON
 *   - `getGroupBalances`/per-person balances unchanged
 *   - a `register_couple` CRDT op enqueued on registration
 */

const NOT_IMPL = '__NOT_IMPLEMENTED__'

/** Seed a couple record directly into the store's localStorage. */
async function seedCouple(page: Page, userA: string, userB: string): Promise<void> {
  await page.evaluate(
    ({ userA, userB }: { userA: string; userB: string }) => {
      const raw = localStorage.getItem('fairshare_store')
      const state = raw ? JSON.parse(raw) : { users: [], groups: [], groupMembers: [], expenses: [], expenseSplits: [], settlements: [], comments: [], nextGroupId: 1, nextExpenseId: 1, nextSettlementId: 1, nextSplitId: 1, nextCommentId: 1 }
      if (!Array.isArray(state.couples)) state.couples = []
      if (!state.nextCoupleId) state.nextCoupleId = 1
      state.couples.push({
        id: state.nextCoupleId++,
        uuid: crypto.randomUUID(),
        user_a: userA,
        user_b: userB,
        created_at: new Date().toISOString(),
      })
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    },
    { userA, userB },
  )
}

/** Set the per-group couple-mode toggle by writing onto the group record. */
async function setGroupCoupleMode(page: Page, groupId: number, enabled: boolean): Promise<void> {
  await page.evaluate(
    ({ groupId, enabled }: { groupId: number; enabled: boolean }) => {
      const raw = localStorage.getItem('fairshare_store')
      const state = JSON.parse(raw)
      const g = state.groups.find((g: any) => g.id === groupId)
      if (g) g.couple_mode = enabled
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    },
    { groupId, enabled },
  )
}

/** Map display names to their user ids from the store. */
async function getUserIds(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((names: string[]) => {
    const raw = localStorage.getItem('fairshare_store')
    const state = raw ? JSON.parse(raw) : { users: [] }
    const map: Record<string, string> = {}
    for (const n of names) {
      const u = state.users.find((u: any) => u.name === n)
      map[n] = u ? u.id : ''
    }
    return map
  }, names)
}

/** Insert an expense with explicit per-member splits (bypasses equal-split). */
async function seedManualExpense(
  page: Page,
  groupId: number,
  paidBy: string,
  amount: number,
  splits: { userId: string; amount: number }[],
  description: string,
): Promise<void> {
  await page.evaluate(
    ({ groupId, paidBy, amount, splits, description }: any) => {
      const raw = localStorage.getItem('fairshare_store')
      const state = JSON.parse(raw)
      const expId = state.nextExpenseId++
      const uuid = crypto.randomUUID()
      const now = new Date().toISOString()
      state.expenses.push({ id: expId, uuid, group_id: groupId, paid_by: paidBy, amount, description, date: now.slice(0, 10), created_at: now })
      for (const s of splits) {
        state.expenseSplits.push({ id: state.nextSplitId++, expense_id: expId, user_id: s.userId, amount: s.amount })
      }
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    },
    { groupId, paidBy, amount, splits, description },
  )
}

/**
 * Call an API function in the page context. Throws a distinctive marker string
 * when the F9 function hasn't been implemented yet, so tests that *require* the
 * function fail loudly (RED) instead of silently passing.
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

/** Attempt a couple registration, returning the error text ('' = success). */
async function attemptRegister(page: Page, userA: string, userB: string): Promise<string> {
  return page.evaluate(
    ({ userA, userB }: { userA: string; userB: string }) => {
      const run = async (): Promise<string> => {
        try {
          const api: any = await import('/src/lib/api.ts')
          const fn = api.registerCouple
          if (typeof fn !== 'function') return '__NOT_IMPLEMENTED__'
          await fn.call(api, userA, userB)
          return ''
        } catch (e: any) {
          return String(e.message || e)
        }
      }
      return run()
    },
    { userA, userB },
  )
}

test.describe('F9 - Couple Mode', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('registers a couple and shows partner on profile', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Home', '', ['Bob'])
    const { Bob } = await getUserIds(page, ['Bob'])
    await gotoApp(page, '/')

    const couple = await callApi(page, 'registerCouple', [aliceId, Bob])
    const found = await callApi(page, 'getCoupleForUser', [aliceId])

    // The registered couple must be retrievable and its partner is Bob.
    expect(couple).toBeTruthy()
    expect(found).toBeTruthy()
    const partnerId = found.user_a === aliceId ? found.user_b : found.user_a
    expect(partnerId).toBe(Bob)
  })

  test('rejects self-pair registration', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    await gotoApp(page, '/')

    const outcome = await attemptRegister(page, aliceId, aliceId)
    // Must NOT be a "not implemented" failure (feature must be present)
    expect(outcome).not.toBe(NOT_IMPL)
    // And it must actually reject a self-pair.
    expect(outcome).not.toBe('')
  })

  test('rejects duplicate couple registration', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Home', '', ['Bob'])
    const { Bob } = await getUserIds(page, ['Bob'])
    await gotoApp(page, '/')

    const first = await attemptRegister(page, aliceId, Bob)
    expect(first).toBe('')
    const second = await attemptRegister(page, aliceId, Bob)
    expect(second).not.toBe(NOT_IMPL)
    expect(second).not.toBe('')
  })

  test('toggles couple mode per-group', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const g1 = await seedGroup(page, 'Home', '', ['Bob'])
    const g2 = await seedGroup(page, 'Work', '', ['Bob'])
    await gotoApp(page, '/')

    await callApi(page, 'setGroupCoupleMode', [g1, true])
    expect(await callApi(page, 'getGroupCoupleMode', [g1])).toBe(true)
    // Independent toggle: group 2 is unaffected.
    expect(await callApi(page, 'getGroupCoupleMode', [g2])).toBeFalsy()

    await callApi(page, 'setGroupCoupleMode', [g1, false])
    expect(await callApi(page, 'getGroupCoupleMode', [g1])).toBe(false)
    expect(await callApi(page, 'getGroupCoupleMode', [g2])).toBeFalsy()
  })

  test('couple mode OFF produces same settlements as before', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob'])
    await seedExpense(page, groupId, 'Groceries', 100)
    await gotoApp(page, '/')

    // Baseline: no couple registered.
    const baseline = await callApi(page, 'getSuggestedSettlements', [groupId])

    // Now register a couple but leave couple mode OFF.
    const aliceId = (await page.evaluate(() => JSON.parse(localStorage.getItem('fairshare_identity')!).id)) as string
    const { Bob } = await getUserIds(page, ['Bob'])
    await seedCouple(page, aliceId, Bob)
    await gotoApp(page, '/') // reload so the app re-reads the store
    const after = await callApi(page, 'getSuggestedSettlements', [groupId])

    expect(after).toEqual(baseline)
  })

  test('couple mode ON nets intra-couple debt', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Carol', 'Dave', 'Eve'])
    const ids = await getUserIds(page, ['Bob', 'Carol', 'Dave', 'Eve'])
    await gotoApp(page, '/')

    // Build balances: Alice +50, Bob -20, Carol -10, Dave -10, Eve -10 (sum 0).
    await seedManualExpense(
      page,
      groupId,
      aliceId,
      100,
      [
        { userId: aliceId, amount: 50 },
        { userId: ids.Bob, amount: 20 },
        { userId: ids.Carol, amount: 10 },
        { userId: ids.Dave, amount: 10 },
        { userId: ids.Eve, amount: 10 },
      ],
      'House bill',
    )
    await seedCouple(page, aliceId, ids.Bob)
    await setGroupCoupleMode(page, groupId, true)
    await gotoApp(page, '/')

    const txns = await callApi(page, 'getSuggestedSettlements', [groupId])

    // No A<->B transaction.
    const intra = txns.filter(
      (t: any) =>
        (t.from_user === aliceId && t.to_user === ids.Bob) ||
        (t.from_user === ids.Bob && t.to_user === aliceId),
    )
    expect(intra).toHaveLength(0)

    // Couple nets to +30 owed by the group (received by the couple, none paid out).
    const toCouple = txns
      .filter((t: any) => t.to_user === aliceId || t.to_user === ids.Bob)
      .reduce((s: number, t: any) => s + t.amount, 0)
    const fromCouple = txns
      .filter((t: any) => t.from_user === aliceId || t.from_user === ids.Bob)
      .reduce((s: number, t: any) => s + t.amount, 0)
    expect(Math.round(toCouple * 100) / 100).toBe(30)
    expect(Math.round(fromCouple * 100) / 100).toBe(0)
  })

  test('couple mode ON affects only settlement suggestions, not balance display', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Carol'])
    const ids = await getUserIds(page, ['Bob', 'Carol'])
    await gotoApp(page, '/')

    // Alice +40, Bob -20, Carol -20 (sum 0).
    await seedManualExpense(
      page,
      groupId,
      aliceId,
      80,
      [
        { userId: aliceId, amount: 40 },
        { userId: ids.Bob, amount: 20 },
        { userId: ids.Carol, amount: 20 },
      ],
      'Shared',
    )
    await seedCouple(page, aliceId, ids.Bob)
    await setGroupCoupleMode(page, groupId, true)
    await gotoApp(page, '/')

    const { balances } = await callApi(page, 'getGroupBalances', [groupId])
    const byUser = new Map<string, number>(balances.map((b: any) => [b.user_id, b.balance]))
    // Per-person balances are unchanged by couple mode.
    expect(byUser.get(aliceId)).toBe(40)
    expect(byUser.get(ids.Bob)).toBe(-20)
    expect(byUser.get(ids.Carol)).toBe(-20)

    const txns = await callApi(page, 'getSuggestedSettlements', [groupId])
    const intra = txns.filter(
      (t: any) =>
        (t.from_user === aliceId && t.to_user === ids.Bob) ||
        (t.from_user === ids.Bob && t.to_user === aliceId),
    )
    expect(intra).toHaveLength(0)
  })

  test('multiple couples each net independently', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    // 6 members: Alice(A), Bob(B) couple1; Carol(C), Dave(D) couple2; Eve(E), Frank(F).
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Carol', 'Dave', 'Eve', 'Frank'])
    const ids = await getUserIds(page, ['Bob', 'Carol', 'Dave', 'Eve', 'Frank'])
    await gotoApp(page, '/')

    // Balances: A+40, B-30, C+25, D-15, E-10, F-10 (sum 0).
    await seedManualExpense(page, groupId, aliceId, 60, [
      { userId: aliceId, amount: 20 },
      { userId: ids.Bob, amount: 30 },
      { userId: ids.Carol, amount: 10 },
    ], 'Exp A')
    await seedManualExpense(page, groupId, ids.Carol, 50, [
      { userId: ids.Carol, amount: 15 },
      { userId: ids.Dave, amount: 15 },
      { userId: ids.Eve, amount: 10 },
      { userId: ids.Frank, amount: 10 },
    ], 'Exp C')
    await seedCouple(page, aliceId, ids.Bob)
    await seedCouple(page, ids.Carol, ids.Dave)
    await setGroupCoupleMode(page, groupId, true)
    await gotoApp(page, '/')

    const txns = await callApi(page, 'getSuggestedSettlements', [groupId])
    const intra1 = txns.filter(
      (t: any) => (t.from_user === aliceId && t.to_user === ids.Bob) || (t.from_user === ids.Bob && t.to_user === aliceId),
    )
    const intra2 = txns.filter(
      (t: any) => (t.from_user === ids.Carol && t.to_user === ids.Dave) || (t.from_user === ids.Dave && t.to_user === ids.Carol),
    )
    expect(intra1).toHaveLength(0)
    expect(intra2).toHaveLength(0)

    // Couple1 nets +10, couple2 nets +10 to be settled externally.
    const c1 = txns
      .filter((t: any) => t.to_user === aliceId || t.to_user === ids.Bob)
      .reduce((s: number, t: any) => s + t.amount, 0)
    const c2 = txns
      .filter((t: any) => t.to_user === ids.Carol || t.to_user === ids.Dave)
      .reduce((s: number, t: any) => s + t.amount, 0)
    expect(Math.round(c1 * 100) / 100).toBe(10)
    expect(Math.round(c2 * 100) / 100).toBe(10)
  })

  test('unregister couple restores normal settlements', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Home', '', ['Bob', 'Carol'])
    const ids = await getUserIds(page, ['Bob', 'Carol'])
    await gotoApp(page, '/')

    await seedManualExpense(page, groupId, aliceId, 80, [
      { userId: aliceId, amount: 40 },
      { userId: ids.Bob, amount: 20 },
      { userId: ids.Carol, amount: 20 },
    ], 'Shared')
    await gotoApp(page, '/')

    // Register the couple and toggle couple mode ON -> netted (no A<->B).
    const couple = await callApi(page, 'registerCouple', [aliceId, ids.Bob])
    await callApi(page, 'setGroupCoupleMode', [groupId, true])
    const netted = await callApi(page, 'getSuggestedSettlements', [groupId])
    const nettedIntra = netted.filter(
      (t: any) => (t.from_user === aliceId && t.to_user === ids.Bob) || (t.from_user === ids.Bob && t.to_user === aliceId),
    )
    expect(nettedIntra).toHaveLength(0)

    // Unregister the couple by its numeric id; the toggle stays ON but with no
    // couple registered, netting no longer applies and A<->B can appear again.
    await callApi(page, 'unregisterCouple', [couple.id])
    const restored = await callApi(page, 'getSuggestedSettlements', [groupId])
    const restoredIntra = restored.filter(
      (t: any) => (t.from_user === aliceId && t.to_user === ids.Bob) || (t.from_user === ids.Bob && t.to_user === aliceId),
    )
    expect(restoredIntra.length).toBeGreaterThan(0)
  })

  test('couple mode syncs via CRDT', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Home', '', ['Bob'])
    const { Bob } = await getUserIds(page, ['Bob'])
    await gotoApp(page, '/')

    await callApi(page, 'registerCouple', [aliceId, Bob])

    const queue = await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_sync_queue')
      return raw ? JSON.parse(raw) : []
    })
    const ops = queue.map((q: any) => q.op).filter((o: any) => o.type === 'register_couple')
    expect(ops.length).toBeGreaterThan(0)
  })
})
