import type { Expense, ExpenseSplit, Settlement, Member } from './engine'

const STORAGE_KEY = 'fairshare_store'

/* ─── Internal record types ─── */

interface UserRecord {
  id: string
  name: string
}

interface GroupRecord {
  id: number
  name: string
  description: string | null
  created_at: string
}

interface GroupMemberRecord {
  group_id: number
  user_id: string
}

interface ExpenseRecord {
  id: number
  group_id: number
  paid_by: string
  amount: number
  description: string
  date: string
}

interface ExpenseSplitRecord {
  id: number
  expense_id: number
  user_id: string
  amount: number
}

interface SettlementRecord {
  id: number
  group_id: number
  from_user: string
  to_user: string
  amount: number
  date: string
}

/* ─── Store state ─── */

interface StoreState {
  users: UserRecord[]
  groups: GroupRecord[]
  groupMembers: GroupMemberRecord[]
  expenses: ExpenseRecord[]
  expenseSplits: ExpenseSplitRecord[]
  settlements: SettlementRecord[]
  nextGroupId: number
  nextExpenseId: number
  nextSettlementId: number
  nextSplitId: number
}

/* ─── Public store class ─── */

export class LocalStore {
  private state: StoreState

  constructor() {
    this.state = this.load()
  }

  /* Persistence */
  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // storage full or unavailable — silently degrade
    }
  }

  private load(): StoreState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as StoreState
    } catch {
      // corrupted — start fresh
    }
    return this.emptyState()
  }

  private emptyState(): StoreState {
    return {
      users: [],
      groups: [],
      groupMembers: [],
      expenses: [],
      expenseSplits: [],
      settlements: [],
      nextGroupId: 1,
      nextExpenseId: 1,
      nextSettlementId: 1,
      nextSplitId: 1,
    }
  }

  reset() {
    this.state = this.emptyState()
    this.save()
  }

  /* ─── Users ─── */

  upsertUser(id: string, name: string): UserRecord {
    let existing = this.state.users.find((u) => u.id === id)
    if (existing) {
      existing.name = name
    } else {
      existing = { id, name }
      this.state.users.push(existing)
    }
    this.save()
    return existing
  }

  getUser(id: string): UserRecord | undefined {
    return this.state.users.find((u) => u.id === id)
  }

  getUsers(): UserRecord[] {
    return [...this.state.users]
  }

  /* ─── Groups ─── */

  createGroup(name: string, description: string | null, memberIds: string[]): GroupRecord & { members: Member[] } {
    const id = this.state.nextGroupId++
    const now = new Date().toISOString().slice(0, 10)
    const group: GroupRecord = { id, name, description, created_at: now }
    this.state.groups.push(group)

    // Add members
    for (const userId of memberIds) {
      this.state.groupMembers.push({ group_id: id, user_id: userId })
    }

    this.save()
    return { ...group, members: this.getGroupMembers(id) }
  }

  getGroup(id: number): GroupRecord | undefined {
    return this.state.groups.find((g) => g.id === id)
  }

  getGroups(): GroupRecord[] {
    return [...this.state.groups]
  }

  getUserGroupIds(userId: string): number[] {
    return this.state.groupMembers
      .filter((gm) => gm.user_id === userId)
      .map((gm) => gm.group_id)
  }

  getGroupMembers(groupId: number): Member[] {
    const userIds = this.state.groupMembers
      .filter((gm) => gm.group_id === groupId)
      .map((gm) => gm.user_id)

    return userIds
      .map((uid) => {
        const u = this.state.users.find((usr) => usr.id === uid)
        return u ? { id: u.id, name: u.name } : null
      })
      .filter((m): m is Member => m !== null)
  }

  /* ─── Expenses ─── */

  createExpense(
    groupId: number,
    paidBy: string,
    amount: number,
    description: string,
    splits: { user_id: string; amount: number }[],
  ): Expense {
    const id = this.state.nextExpenseId++
    const now = new Date().toISOString().slice(0, 10)
    const exp: ExpenseRecord = {
      id,
      group_id: groupId,
      paid_by: paidBy,
      amount,
      description,
      date: now,
    }
    this.state.expenses.push(exp)

    const paidByName = this.state.users.find((u) => u.id === paidBy)?.name || 'Unknown'

    const splitRecords: ExpenseSplitRecord[] = splits.map((s) => {
      const sid = this.state.nextSplitId++
      return { id: sid, expense_id: id, user_id: s.user_id, amount: s.amount }
    })
    this.state.expenseSplits.push(...splitRecords)

    const expenseSplits: ExpenseSplit[] = splitRecords.map((sr) => ({
      user_id: sr.user_id,
      user_name: this.state.users.find((u) => u.id === sr.user_id)?.name || 'Unknown',
      amount: sr.amount,
    }))

    this.save()

    return {
      id,
      group_id: groupId,
      paid_by: paidBy,
      paid_by_name: paidByName,
      amount,
      description,
      date: now,
      splits: expenseSplits,
    }
  }

  getGroupExpenses(groupId: number): Expense[] {
    const exps = this.state.expenses.filter((e) => e.group_id === groupId)
    return exps.map((e) => {
      const paidByName = this.state.users.find((u) => u.id === e.paid_by)?.name || 'Unknown'
      const splits = this.state.expenseSplits
        .filter((s) => s.expense_id === e.id)
        .map((s) => ({
          user_id: s.user_id,
          user_name: this.state.users.find((u) => u.id === s.user_id)?.name || 'Unknown',
          amount: s.amount,
        }))
      return { ...e, paid_by_name: paidByName, splits }
    })
  }

  /* ─── Settlements ─── */

  createSettlement(
    groupId: number,
    fromUser: string,
    toUser: string,
    amount: number,
  ): Settlement {
    const id = this.state.nextSettlementId++
    const now = new Date().toISOString().slice(0, 10)
    const record: SettlementRecord = {
      id,
      group_id: groupId,
      from_user: fromUser,
      to_user: toUser,
      amount,
      date: now,
    }
    this.state.settlements.push(record)

    const fromName = this.state.users.find((u) => u.id === fromUser)?.name || 'Unknown'
    const toName = this.state.users.find((u) => u.id === toUser)?.name || 'Unknown'

    this.save()

    return {
      id,
      group_id: groupId,
      from_user: fromUser,
      from_user_name: fromName,
      to_user: toUser,
      to_user_name: toName,
      amount,
      date: now,
    }
  }

  getGroupSettlements(groupId: number): Settlement[] {
    return this.state.settlements
      .filter((s) => s.group_id === groupId)
      .map((s) => {
        const fromName = this.state.users.find((u) => u.id === s.from_user)?.name || 'Unknown'
        const toName = this.state.users.find((u) => u.id === s.to_user)?.name || 'Unknown'
        return { ...s, from_user_name: fromName, to_user_name: toName }
      })
  }

  /* ─── Raw data export for sync ─── */

  getAllData(): StoreState {
    return JSON.parse(JSON.stringify(this.state))
  }
}

/** Singleton store instance shared across the app */
export const store = new LocalStore()