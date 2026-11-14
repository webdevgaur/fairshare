import { test as base, type Page, type BrowserContext } from '@playwright/test'

export { expect } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

/**
 * Navigate to a blank page on the app origin so localStorage is accessible,
 * then clear all FairShare-related keys.
 */
export async function clearStorage(page: Page) {
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    const keys = [
      'fairshare_identity',
      'fairshare_store',
      'fairshare_ed25519_priv',
      'fairshare_ed25519_pub',
    ]
    for (const k of keys) {
      localStorage.removeItem(k)
    }
  })
}

/**
 * Seed a local identity into localStorage so the name prompt is skipped.
 * Call after clearStorage() and before gotoApp().
 */
export async function seedIdentity(page: Page, name: string): Promise<string> {
  // Navigate to base URL first if not already on the origin
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto(BASE_URL)
    await page.waitForLoadState('domcontentloaded')
  }

  const fp = await page.evaluate((n: string) => {
    const privKey = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5'
    const pubKey = 'b0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5'
    localStorage.setItem('fairshare_ed25519_priv', privKey)
    localStorage.setItem('fairshare_ed25519_pub', pubKey)

    // Compute fingerprint using FNV-1a (same algorithm as the app)
    const bytes = new Uint8Array(pubKey.length / 2)
    for (let i = 0; i < pubKey.length; i += 2) {
      bytes[i / 2] = parseInt(pubKey.slice(i, i + 2), 16)
    }
    let hash = 2166136261
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i]
      hash = Math.imul(hash, 16777619)
    }
    const fp = (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
    localStorage.setItem('fairshare_identity', JSON.stringify({ id: fp, name: n }))
    return fp
  }, name)
  return fp
}

/**
 * Create a group via the store API (localStorage), bypassing the UI.
 * Call after seedIdentity() and before gotoApp().
 */
export async function seedGroup(page: Page, name: string, description: string, members: string[]): Promise<number> {
  const groupId = await page.evaluate(({ name, description, members }) => {
    const raw = localStorage.getItem('fairshare_store')
    let state = raw ? JSON.parse(raw) : {
      users: [], groups: [], groupMembers: [], expenses: [],
      expenseSplits: [], settlements: [],
      nextGroupId: 1, nextExpenseId: 1, nextSettlementId: 1, nextSplitId: 1,
    }

    const identityRaw = localStorage.getItem('fairshare_identity')
    if (!identityRaw) return -1
    const identity = JSON.parse(identityRaw)

    // Ensure user exists in store
    const userExists = state.users.find((u: any) => u.id === identity.id)
    if (!userExists) {
      state.users.push({ id: identity.id, name: identity.name })
    }

    const id = state.nextGroupId++
    const now = new Date().toISOString().slice(0, 10)
    state.groups.push({ id, uuid: crypto.randomUUID(), name, description, created_at: now })

    const memberIds = [identity.id]
    for (const mName of members) {
      const existing = state.users.find((u: any) => u.name === mName)
      if (existing) {
        memberIds.push(existing.id)
      } else {
        const newId = crypto.randomUUID()
        state.users.push({ id: newId, name: mName })
        memberIds.push(newId)
      }
    }

    for (const uid of memberIds) {
      state.groupMembers.push({ group_id: id, user_id: uid })
    }

    localStorage.setItem('fairshare_store', JSON.stringify(state))
    return id
  }, { name, description, members })
  return groupId
}

/**
 * Create an expense for a group via the store API. Generates and stores a
 * stable `uuid` (the cross-device identifier F6 comments rely on) and an
 * `created_at` timestamp. Returns `{ id, uuid }` so callers can attach
 * comments to the expense by uuid.
 */
export async function seedExpense(
  page: Page,
  groupId: number,
  description: string,
  amount: number,
  opts?: { category?: string; date?: string },
): Promise<{ id: number; uuid: string }> {
  return page.evaluate(({ groupId, description, amount, category, optsDate }) => {
    const raw = localStorage.getItem('fairshare_store')
    if (!raw) return { id: -1, uuid: '' }
    const state = JSON.parse(raw)
    const identityRaw = localStorage.getItem('fairshare_identity')
    if (!identityRaw) return { id: -1, uuid: '' }
    const identity = JSON.parse(identityRaw)

    const members = state.groupMembers
      .filter((gm: any) => gm.group_id === groupId)
      .map((gm: any) => {
        const u = state.users.find((usr: any) => usr.id === gm.user_id)
        return u ? { id: u.id, name: u.name } : null
      })
      .filter(Boolean)

    const expId = state.nextExpenseId++
    const uuid = crypto.randomUUID()
    const now = new Date().toISOString()
    state.expenses.push({
      id: expId,
      uuid,
      group_id: groupId,
      paid_by: identity.id,
      amount,
      description,
      date: optsDate || now.slice(0, 10),
      created_at: now,
      ...(category ? { category } : {}),
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
  }, { groupId, description, amount, category: opts?.category, optsDate: opts?.date })
}

/**
 * Seed a text comment on an expense directly into the store. The comment is
 * keyed by the expense's `uuid` (passed by the caller) and attributed to the
 * current identity.
 */
export async function seedComment(
  page: Page,
  groupId: number,
  expenseId: number,
  expenseUuid: string,
  text: string,
): Promise<number> {
  const commentId = await page.evaluate(({ groupId, expenseId, expenseUuid, text }) => {
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
      author_id: identity.id,
      author_name: identity.name,
      text,
      created_at: new Date().toISOString(),
    })

    localStorage.setItem('fairshare_store', JSON.stringify(state))
    return cid
  }, { groupId, expenseId, expenseUuid, text })
  return commentId
}

/**
 * Create a settlement via the store API.
 */
export async function seedSettlement(
  page: Page,
  groupId: number,
  amount: number,
): Promise<number> {
  const settlementId = await page.evaluate(({ groupId, amount }) => {
    const raw = localStorage.getItem('fairshare_store')
    if (!raw) return -1
    const state = JSON.parse(raw)
    const identityRaw = localStorage.getItem('fairshare_identity')
    if (!identityRaw) return -1
    const identity = JSON.parse(identityRaw)

    // Find member with negative balance (the one who owes)
    const members = state.groupMembers
      .filter((gm: any) => gm.group_id === groupId)
      .map((gm: any) => {
        const u = state.users.find((usr: any) => usr.id === gm.user_id)
        return u ? { id: u.id, name: u.name } : null
      })
      .filter(Boolean)

    // Calculate who owes whom based on expenses
    const expenses = state.expenses.filter((e: any) => e.group_id === groupId)
    const settlements = state.settlements.filter((s: any) => s.group_id === groupId)
    
    // Simple balance calculation
    const balances: Record<string, number> = {}
    for (const m of members) {
      balances[m.id] = 0
    }
    
    for (const exp of expenses) {
      const paidBy = exp.paid_by
      const splits = state.expenseSplits.filter((s: any) => s.expense_id === exp.id)
      for (const s of splits) {
        balances[paidBy] = (balances[paidBy] || 0) + s.amount
        balances[s.user_id] = (balances[s.user_id] || 0) - s.amount
      }
    }
    
    for (const st of settlements) {
      balances[st.from_user] = (balances[st.from_user] || 0) + st.amount
      balances[st.to_user] = (balances[st.to_user] || 0) - st.amount
    }

    // Find someone with negative balance (they owe) and someone with positive (they're owed)
    const debtor = members.find((m: any) => (balances[m.id] || 0) < 0)
    const creditor = members.find((m: any) => (balances[m.id] || 0) > 0)
    
    if (!debtor || !creditor) return -1

    const sid = state.nextSettlementId++
    const now = new Date().toISOString()
    state.settlements.push({
      id: sid,
      uuid: crypto.randomUUID(),
      group_id: groupId,
      from_user: debtor.id,
      to_user: creditor.id,
      amount,
      date: now.slice(0, 10),
      created_at: now,
    })

    localStorage.setItem('fairshare_store', JSON.stringify(state))
    return sid
  }, { groupId, amount })
  return settlementId
}

/**
 * Navigate to the app and wait for the page to settle.
 */
export async function gotoApp(page: Page, path = '/') {
  await page.goto(`${BASE_URL}${path}`)
  await page.waitForLoadState('networkidle')
}

// Extend base test
export const test = base