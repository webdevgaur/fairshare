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
  /** Globally-unique stable identifier shared across devices (via CRDT sync). */
  uuid: string
  group_id: number
  paid_by: string
  paid_by_name: string
  amount: number
  description: string
  /** Business date of the expense, YYYY-MM-DD. */
  date: string
  /** Full ISO timestamp when the expense was created — used for activity-feed sorting. */
  created_at: string
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
  created_at: string
}

/**
 * A text comment left on an expense. References the expense by its stable
 * `uuid` (not its device-local numeric id) so it attaches to the same
 * expense on every device after sync.
 */
export interface Comment {
  id: number
  group_id: number
  expense_uuid: string
  expense_id: number
  author_id: string
  author_name: string
  text: string
  created_at: string
}

export interface BalanceEntry {
  user_id: string
  user_name: string
  balance: number
}

export interface PaymentHandles {
  venmo_username?: string | null
  paypal_handle?: string | null
  cashapp_cashtag?: string | null
}

export interface Transaction {
  from_user: string
  from_user_name: string
  to_user: string
  to_user_name: string
  amount: number
}

/* ─── Unified activity feed ─── */

/** An expense line in the unified activity feed. */
export interface ActivityExpenseItem {
  kind: 'expense'
  id: number
  uuid: string
  group_id: number
  user_id: string
  user_name: string
  description: string
  amount: number
  date: string
  created_at: string
  splits: ExpenseSplit[]
}

/** A settlement line in the unified activity feed. */
export interface ActivitySettlementItem {
  kind: 'settlement'
  id: number
  group_id: number
  from_user: string
  from_user_name: string
  to_user: string
  to_user_name: string
  amount: number
  date: string
  created_at: string
}

/** A comment line in the unified activity feed. */
export interface ActivityCommentItem {
  kind: 'comment'
  id: number
  group_id: number
  expense_uuid: string
  expense_id: number
  author_id: string
  author_name: string
  text: string
  created_at: string
}

export type ActivityItem =
  | ActivityExpenseItem
  | ActivitySettlementItem
  | ActivityCommentItem

/**
 * Greedy debt-simplification algorithm.
 *
 * Given per-member balances, produce a minimal-ish set of transactions that
 * settles everyone. Each iteration pairs the largest creditor with the largest
 * debtor and transfers the smaller amount, then removes anyone who is settled
 * (within a 0.005 rounding tolerance).
 */
export function simplifyDebts(balances: BalanceEntry[]): Transaction[] {
  const creditors = balances
    .filter((b) => b.balance > 0)
    .map((b) => ({ user_id: b.user_id, user_name: b.user_name, amount: b.balance }))
  const debtors = balances
    .filter((b) => b.balance < 0)
    .map((b) => ({ user_id: b.user_id, user_name: b.user_name, amount: -b.balance }))

  const transactions: Transaction[] = []

  while (creditors.length > 0 && debtors.length > 0) {
    // Find the largest creditor and largest debtor
    let ci = 0
    let di = 0
    for (let i = 1; i < creditors.length; i++) {
      if (creditors[i].amount > creditors[ci].amount) ci = i
    }
    for (let i = 1; i < debtors.length; i++) {
      if (debtors[i].amount > debtors[di].amount) di = i
    }

    const creditor = creditors[ci]
    const debtor = debtors[di]
    const transfer = Math.min(debtor.amount, creditor.amount)

    if (transfer > 0.004) {
      transactions.push({
        from_user: debtor.user_id,
        from_user_name: debtor.user_name,
        to_user: creditor.user_id,
        to_user_name: creditor.user_name,
        amount: Math.round(transfer * 100) / 100,
      })
    }

    debtor.amount -= transfer
    creditor.amount -= transfer

    if (debtor.amount < 0.005) debtors.splice(di, 1)
    if (creditor.amount < 0.005) creditors.splice(ci, 1)
  }

  return transactions
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