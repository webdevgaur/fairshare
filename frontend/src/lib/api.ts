import { store } from './store'
import { calculateBalances, type BalanceEntry, type Expense, type Settlement } from './engine'
import { getLocalUser } from './identity'
import { syncClient } from './sync'

/* ─── Re-export types ─── */

export type { BalanceEntry, Expense, Settlement }
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

  syncClient.enqueue('create_group', { id: group.id, name, description, member_ids: allMemberIds })

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
  )

  syncClient.enqueue('create_expense', {
    group_id: data.group_id,
    amount: data.amount,
    description: data.description,
    paid_by: user.id,
    splits: resolvedSplits,
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
  const settlement = store.createSettlement(data.group_id, data.from_user, data.to_user, data.amount)

  syncClient.enqueue('create_settlement', {
    group_id: data.group_id,
    from_user: data.from_user,
    to_user: data.to_user,
    amount: data.amount,
  })

  return settlement
}