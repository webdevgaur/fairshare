import { store, type StoreState } from './store'
import { calculateBalances, simplifyDebts, type BalanceEntry, type Expense, type Settlement, type Transaction, type PaymentHandles, type Comment, type ActivityItem } from './engine'
import { getLocalUser } from './identity'
import { syncClient } from './sync'
import { buildActivityFeed } from './feed'
import { exportJSON, buildCSVBundle, parseJSON, parseSplitwiseCSV, isSplitwiseCSV } from './exportImport'

/* ─── Re-export types ─── */

export type { BalanceEntry, Expense, Settlement, Transaction, PaymentHandles, Comment, ActivityItem }
export type { Member } from './engine'

export interface GroupSummary {
  id: number
  name: string
  description: string | null
  total_balance: number
  member_count: number
}

export interface GroupDetail {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface MemberRecord {
  id: string
  name: string
}

/* ─── Auth (local identity) ─── */

export function getCurrentUserId(): string | null {
  return getLocalUser()?.id ?? null
}

export function getCurrentUserName(): string | null {
  return getLocalUser()?.name ?? null
}

/* ─── Groups ─── */

export function getGroups(): GroupSummary[] {
  const user = getLocalUser()
  if (!user) return []

  const groupIds = store.getUserGroupIds(user.id)
  return groupIds.map((gid) => {
    const group = store.getGroup(gid)
    if (!group) return null
    const members = store.getGroupMembers(gid)
    const expenses = store.getGroupExpenses(gid)
    const settlements = store.getGroupSettlements(gid)
    const balances = calculateBalances(expenses, settlements, members)
    const userBalance = balances.find((b) => b.user_id === user.id)?.balance ?? 0
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      total_balance: userBalance,
      member_count: members.length,
    }
  }).filter((g): g is GroupSummary => g !== null)
}

export function createGroup(name: string, description: string, memberNames: string[]): GroupSummary {
  const user = getLocalUser()
  if (!user) throw new Error('No local user')

  // Ensure current user exists in the store
  store.upsertUser(user.id, user.name)

  // Create or find member users
  const memberIds = memberNames.map((n) => {
    // Check if a user with this name already exists
    const existing = store.getUsers().find((u) => u.name === n)
    if (existing) return existing.id
    // Create a new user entry with a random string ID
    const newId = crypto.randomUUID()
    store.upsertUser(newId, n)
    return newId
  })

  // Current user is always included
  const allMemberIds = [user.id, ...memberIds.filter((id) => id !== user.id)]

  const group = store.createGroup(name, description || null, allMemberIds)
  const members = store.getGroupMembers(group.id)
  const expenses = store.getGroupExpenses(group.id)
  const settlements = store.getGroupSettlements(group.id)
  const balances = calculateBalances(expenses, settlements, members)
  const userBalance = balances.find((b) => b.user_id === user.id)?.balance ?? 0

  syncClient.enqueue('create_group', { id: group.id, uuid: group.uuid, name, description, member_ids: allMemberIds })

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    total_balance: userBalance,
    member_count: members.length,
  }
}

export function getGroup(id: number): GroupDetail | undefined {
  const group = store.getGroup(id)
  if (!group) return undefined
  return { id: group.id, name: group.name, description: group.description, created_at: group.created_at }
}

export function getGroupBalances(id: number): { balances: BalanceEntry[] } {
  const members = store.getGroupMembers(id)
  const expenses = store.getGroupExpenses(id)
  const settlements = store.getGroupSettlements(id)
  return { balances: calculateBalances(expenses, settlements, members) }
}

export function getGroupMembers(id: number): MemberRecord[] {
  return store.getGroupMembers(id)
}

/* ─── Expenses ─── */

export function getExpenses(groupId: number): Expense[] {
  return store.getGroupExpenses(groupId)
}

export function createExpense(data: {
  group_id: number
  amount: number
  description: string
  date?: string
  splits: { user_id: string; amount?: number; percentage?: number }[]
}): Expense {
  const user = getLocalUser()
  if (!user) throw new Error('No local user')

  const members = store.getGroupMembers(data.group_id)
  const totalSplits = data.splits.length || members.length

  // Resolve split amounts
  const resolvedSplits = data.splits.map((s) => ({
    user_id: s.user_id,
    amount: s.amount ?? data.amount / totalSplits,
  }))

  const expense = store.createExpense(
    data.group_id,
    user.id,
    data.amount,
    data.description,
    resolvedSplits,
    { date: data.date },
  )

  syncClient.enqueue('create_expense', {
    group_id: data.group_id,
    amount: data.amount,
    description: data.description,
    paid_by: user.id,
    splits: resolvedSplits,
    uuid: expense.uuid,
    date: expense.date,
    created_at: expense.created_at,
  })

  return expense
}

/* ─── Settlements ─── */

export function getSettlements(groupId: number): Settlement[] {
  return store.getGroupSettlements(groupId)
}

export function createSettlement(data: {
  group_id: number
  from_user: string
  to_user: string
  amount: number
  date?: string
}): Settlement {
  const settlement = store.createSettlement(data.group_id, data.from_user, data.to_user, data.amount, {
    date: data.date,
  })

  syncClient.enqueue('create_settlement', {
    group_id: data.group_id,
    uuid: settlement.uuid,
    from_user: data.from_user,
    to_user: data.to_user,
    amount: data.amount,
    date: settlement.date,
    created_at: settlement.created_at,
  })

  return settlement
}

/* ─── Comments ─── */

export function getComments(groupId: number): Comment[] {
  return store.getGroupComments(groupId)
}

export function getExpenseComments(expenseUuid: string): Comment[] {
  return store.getExpenseComments(expenseUuid)
}

export function createComment(groupId: number, expenseUuid: string, text: string): Comment {
  const user = getLocalUser()
  if (!user) throw new Error('No local user')

  const expense = store.getGroupExpenses(groupId).find((e) => e.uuid === expenseUuid)
  const expenseId = expense?.id ?? -1

  const comment = store.createComment(
    groupId,
    expenseUuid,
    expenseId,
    user.id,
    user.name,
    text.trim(),
  )

  syncClient.enqueue('create_comment', {
    group_id: groupId,
    expense_uuid: expenseUuid,
    expense_id: expenseId,
    author_id: user.id,
    author_name: user.name,
    text: comment.text,
  })

  return comment
}

/* ─── Activity feed ─── */

export function getActivityFeed(groupId: number): ActivityItem[] {
  return buildActivityFeed(groupId)
}

/* ─── Payment handles ─── */

export function updatePaymentHandles(userId: string, handles: PaymentHandles): void {
  store.setUserPaymentHandles(userId, handles)
  syncClient.enqueue('update_profile', { user_id: userId, handles })
}

export function getUserPaymentHandles(userId: string): PaymentHandles | null {
  return store.getUserPaymentHandles(userId)
}

/* ─── Suggested settlements ─── */

export function getSuggestedSettlements(groupId: number): Transaction[] {
  const members = store.getGroupMembers(groupId)
  const expenses = store.getGroupExpenses(groupId)
  const settlements = store.getGroupSettlements(groupId)
  const balances = calculateBalances(expenses, settlements, members)
  return simplifyDebts(balances)
}

/* ─── Export / Import (F5) ─── */

export type ImportMode = 'merge' | 'replace'

export interface ImportResult {
  success: boolean
  message: string
  importedCount?: number
  skipped?: string[]
}

export interface ExportPayload {
  json: string
  csv: { filename: string; content: string }[]
}

/** Export the full store as a JSON string plus the three flattened CSV files. */
export function exportData(): ExportPayload {
  return { json: exportJSON(), csv: buildCSVBundle() }
}

/**
 * Import a FairShare JSON export. Mode 'merge' (default) upserts by uuid and
 * appends unmatched entities; mode 'replace' wipes the store first. Validates
 * the whole file before applying anything, so an invalid file changes nothing.
 */
export function importJSON(text: string, mode: ImportMode = 'merge'): ImportResult {
  let data: StoreState
  try {
    data = parseJSON(text).data
  } catch (e) {
    return { success: false, message: (e as Error).message }
  }
  const baseline = collectImportBaseline(store.getAllData())
  store.importStoreState(data, mode)
  enqueueImported(data, baseline)
  const importedCount = data.groups.length + data.expenses.length + data.settlements.length + data.comments.length
  return {
    success: true,
    message: mode === 'replace' ? 'Store replaced with export data.' : 'Export data merged into the store.',
    importedCount,
  }
}

/** Import a Splitwise CSV export into a new group (best-effort, lossy). */
export function importSplitwiseCSV(text: string, groupName?: string): ImportResult {
  let state: StoreState
  let skipped: string[]
  try {
    const result = parseSplitwiseCSV(text, groupName)
    state = result.state
    skipped = result.skipped
  } catch (e) {
    return { success: false, message: (e as Error).message }
  }
  const baseline = collectImportBaseline(store.getAllData())
  store.importStoreState(state, 'merge')
  enqueueImported(state, baseline)
  const n = state.expenses.length
  const msg = `Imported ${n} expense(s).${skipped.length ? ` ${skipped.length} row(s) skipped: ${skipped.slice(0, 3).join('; ')}` : ''}`
  return { success: true, message: msg, importedCount: n, skipped }
}

/** Whether an uploaded text blob looks like a Splitwise CSV export. */
export function isSplitwiseImport(text: string): boolean {
  return isSplitwiseCSV(text)
}

/** Which entities already exist locally before an import (the merge dedupes by uuid). */
interface ImportBaseline {
  groupUuids: Set<string>
  expenseUuids: Set<string>
  settlementUuids: Set<string>
  commentKeys: Set<string>
}

/**
 * Snapshot the uuids currently in the store so the import broadcast only
 * re-sends records that are genuinely new. Peers do not dedupe by uuid, so
 * re-broadcasting an entity that already exists would create a duplicate on them.
 */
function collectImportBaseline(state: StoreState): ImportBaseline {
  const groupUuids = new Set<string>()
  const expenseUuids = new Set<string>()
  const settlementUuids = new Set<string>()
  const commentKeys = new Set<string>()
  for (const g of state.groups) groupUuids.add(g.uuid)
  for (const e of state.expenses) expenseUuids.add(e.uuid)
  for (const s of state.settlements) settlementUuids.add(s.uuid)
  for (const c of state.comments) commentKeys.add(`${c.expense_uuid}|${c.author_id}|${c.text}|${c.created_at}`)
  return { groupUuids, expenseUuids, settlementUuids, commentKeys }
}

/**
 * Enqueue only records that were actually NEW during the import as CRDT ops so
 * peers receive them. Entities already present locally (matched by uuid) are
 * skipped, and every numeric id is read from the applied (post-merge) store
 * because numeric ids are device-local and regenerated by importStoreState.
 */
function enqueueImported(data: StoreState, baseline: ImportBaseline): void {
  const merged = store.getAllData()
  const mergedGroupByUuid = new Map<string, (typeof merged.groups)[number]>()
  for (const g of merged.groups) mergedGroupByUuid.set(g.uuid, g)
  const mergedExpenseByUuid = new Map<string, (typeof merged.expenses)[number]>()
  for (const e of merged.expenses) mergedExpenseByUuid.set(e.uuid, e)
  const mergedSettlementByUuid = new Map<string, (typeof merged.settlements)[number]>()
  for (const s of merged.settlements) mergedSettlementByUuid.set(s.uuid, s)

  const membersByGroup = new Map<number, string[]>()
  for (const gm of merged.groupMembers) {
    membersByGroup.set(gm.group_id, [...(membersByGroup.get(gm.group_id) ?? []), gm.user_id])
  }

  for (const g of data.groups) {
    if (baseline.groupUuids.has(g.uuid)) continue
    const mg = mergedGroupByUuid.get(g.uuid)
    if (!mg) continue
    syncClient.enqueue('create_group', {
      id: mg.id,
      uuid: mg.uuid,
      name: mg.name,
      description: mg.description,
      member_ids: membersByGroup.get(mg.id) ?? [],
    })
  }
  for (const e of data.expenses) {
    if (baseline.expenseUuids.has(e.uuid)) continue
    const me = mergedExpenseByUuid.get(e.uuid)
    if (!me) continue
    const splits = merged.expenseSplits.filter((s) => s.expense_id === me.id).map((s) => ({ user_id: s.user_id, amount: s.amount }))
    syncClient.enqueue('create_expense', {
      group_id: me.group_id,
      amount: me.amount,
      description: me.description,
      paid_by: me.paid_by,
      splits,
      uuid: me.uuid,
      date: me.date,
      created_at: me.created_at,
    })
  }
  for (const s of data.settlements) {
    if (baseline.settlementUuids.has(s.uuid)) continue
    const ms = mergedSettlementByUuid.get(s.uuid)
    if (!ms) continue
    syncClient.enqueue('create_settlement', {
      group_id: ms.group_id,
      uuid: ms.uuid,
      from_user: ms.from_user,
      to_user: ms.to_user,
      amount: ms.amount,
      date: ms.date,
      created_at: ms.created_at,
    })
  }
  for (const c of data.comments) {
    const key = `${c.expense_uuid}|${c.author_id}|${c.text}|${c.created_at}`
    if (baseline.commentKeys.has(key)) continue
    const mc = merged.comments.find(
      (m) => m.expense_uuid === c.expense_uuid && m.author_id === c.author_id && m.text === c.text && m.created_at === c.created_at,
    )
    if (!mc) continue
    syncClient.enqueue('create_comment', {
      group_id: mc.group_id,
      expense_uuid: mc.expense_uuid,
      expense_id: mc.expense_id,
      author_id: mc.author_id,
      author_name: mc.author_name,
      text: mc.text,
    })
  }
}