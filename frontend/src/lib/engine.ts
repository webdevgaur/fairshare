export interface Member {
  id: string
  name: string
}

export interface ExpenseSplit {
  user_id: string
  user_name: string
  amount: number
}

export interface Expense {
  id: number
  group_id: number
  paid_by: string
  paid_by_name: string
  amount: number
  description: string
  date: string
  splits: ExpenseSplit[]
}

export interface Settlement {
  id: number
  group_id: number
  from_user: string
  from_user_name: string
  to_user: string
  to_user_name: string
  amount: number
  date: string
}

export interface BalanceEntry {
  user_id: string
  user_name: string
  balance: number
}

/**
 * Calculate per-member balances for a group based on expenses and settlements.
 *
 * Balance = total paid by user as payer - total owed by user via splits
 *          - total paid out in settlements + total received in settlements
 */
export function calculateBalances(
  expenses: Expense[],
  settlements: Settlement[],
  members: Member[],
): BalanceEntry[] {
  const balances: Record<string, number> = {}

  for (const m of members) {
    balances[m.id] = 0
  }

  // Expenses: payer gets credited the full amount, each split participant gets debited their share
  for (const exp of expenses) {
    if (balances[exp.paid_by] !== undefined) {
      balances[exp.paid_by] += exp.amount
    }
    for (const split of exp.splits) {
      if (balances[split.user_id] !== undefined) {
        balances[split.user_id] -= split.amount
      }
    }
  }

  // Settlements: payer loses amount, receiver gains amount
  for (const s of settlements) {
    if (balances[s.from_user] !== undefined) {
      balances[s.from_user] -= s.amount
    }
    if (balances[s.to_user] !== undefined) {
      balances[s.to_user] += s.amount
    }
  }

  return members.map((m) => ({
    user_id: m.id,
    user_name: m.name,
    balance: Math.round((balances[m.id] || 0) * 100) / 100,
  }))
}