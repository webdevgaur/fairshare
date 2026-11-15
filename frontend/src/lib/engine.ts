import type { CoupleRecord } from './store'

export interface Member {
  id: string
  name: string
}

/**
 * A sealed, E2E-encrypted CRDT operation envelope (ADR-E2E-ENCRYPTION §6.1).
 * Carried as a WebSocket binary frame; the relay sees only `bytes`. The sender's
 * public keys ride in the envelope so the receiver can locate its wrapped key,
 * decrypt, and verify authorship against the signed member directory.
 */
export interface SealedOpEnvelope {
  /** Opaque binary frame relayed verbatim to the room. */
  bytes: Uint8Array
  /** Sender's Ed25519 public key (hex) — used to verify the signature. */
  senderPublicKey: string
  /** Sender's ephemeral X25519 public key (hex) — used for key agreement. */
  senderX25519PublicKey: string
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
  /**
   * Optional curated category (one of CATEGORIES). Absent/unknown values fold
   * into "Other" at read-time (see normalizeCategory), so records stay honest.
   */
  category?: string
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

export interface PendingInvite {
  id: number
  /** Globally-unique stable identifier shared across devices. */
  uuid: string
  group_id: number
  inviter_id: string
  inviter_name: string
  invitee_id?: string | null
  invitee_name?: string | null
  token: string
  status: 'pending' | 'accepted' | 'declined'
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

/**
 * Optional F9 couple-netting configuration threaded into the settlement
 * suggestion path. When `enabled`, `netCoupleBalances` folds each registered
 * couple present in the group into a single net position before simplification.
 * Absent config = no netting (backward compatible).
 */
export interface CoupleNettingConfig {
  couples: CoupleRecord[]
  enabled: boolean
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
 *
 * When an F9 `CoupleNettingConfig` is supplied with `enabled: true`, couples
 * present in the group are folded into a single net position before
 * simplification (`netCoupleBalances`), and a defensive filter drops any
 * residual transaction directly between the two partners so no A→B edge is ever
 * emitted (AC #5). Absent config = unchanged behaviour (backward compatible).
 */
export function simplifyDebts(balances: BalanceEntry[], config?: CoupleNettingConfig): Transaction[] {
  const working = config && config.enabled && config.couples.length > 0
    ? netCoupleBalances(balances, config.couples, true)
    : balances

  const creditors = working
    .filter((b) => b.balance > 0)
    .map((b) => ({ user_id: b.user_id, user_name: b.user_name, amount: b.balance }))
  const debtors = working
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

  // Defensive F9 guard: never settle directly between the partners of a
  // registered couple, regardless of the greedy pairing. Couples are normally
  // folded into a single pseudo-member above, so this rarely fires, but it
  // guarantees AC #5 even if only part of a couple is present in the balances.
  if (config && config.enabled) {
    const partnerPairs = new Set<string>()
    for (const c of config.couples) {
      partnerPairs.add(pairKey(c.user_a, c.user_b))
    }
    return transactions.filter((t) => !partnerPairs.has(pairKey(t.from_user, t.to_user)))
  }

  return transactions
}

/** Canonical unordered key for a pair of user ids. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
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

/**
 * F9 couple netting: fold each registered couple present in `balances` into a
 * single net position keyed by `user_a`, and zero out `user_b`, so the pair has
 * exactly one entry in the simplification output (never an A↔B transaction).
 *
 * This is a *post-processing* step over `calculateBalances` output — it leaves
 * each member's individual balance on the balance sheet untouched (only the
 * settlement-suggestion path consumes the netted view). When disabled (or no
 * couples are given) the input is returned unchanged.
 */
export function netCoupleBalances(
  balances: BalanceEntry[],
  couples: CoupleRecord[],
  enabled: boolean,
): BalanceEntry[] {
  if (!enabled || couples.length === 0) return balances

  const result = balances.map((b) => ({ ...b }))

  for (const couple of couples) {
    const a = result.find((b) => b.user_id === couple.user_a)
    const b = result.find((b) => b.user_id === couple.user_b)
    if (!a || !b) continue // both members must be present in the group balances
    a.balance = round2(a.balance + b.balance)
    b.balance = 0
  }

  return result
}

/* ─── Spending Insights & Analytics (F3) ─── */

/**
 * The 12 curated categories. The picker offers exactly these; unassigned and
 * unknown/normalized strings fold into "Other" (see normalizeCategory).
 * Kept as a `const` array so it can be used directly in a picker.
 */
export const CATEGORIES = [
  'Food',
  'Transport',
  'Utilities',
  'Entertainment',
  'Groceries',
  'Dining Out',
  'Travel',
  'Shopping',
  'Health',
  'Rent',
  'Education',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** The bucket that unassigned / unknown categories fold into. */
export const OTHER_CATEGORY = 'Other'

/**
 * Normalize a free-string category to one of CATEGORIES. Trims and compares
 * case-insensitively; anything unrecognised (or absent) becomes "Other".
 */
export function normalizeCategory(category?: string | null): string {
  if (!category) return OTHER_CATEGORY
  const trimmed = category.trim()
  if (!trimmed) return OTHER_CATEGORY
  const lower = trimmed.toLowerCase()
  const match = CATEGORIES.find((c) => c.toLowerCase() === lower)
  return match ?? OTHER_CATEGORY
}

/** Spend summed for one category (or one month bucket). */
export interface CategorySpend {
  category: string
  amount: number
}

/** Spend summed for one calendar month, keyed by `YYYY-MM`. */
export interface MonthlySpend {
  month: string
  amount: number
}

/** On-read aggregation of spending across the given expenses. */
export interface AnalyticsSummary {
  totalAllTime: number
  totalThisMonth: number
  totalLastMonth: number
  expenseCount: number
  /** Category breakdown, descending by amount. */
  byCategory: CategorySpend[]
  /** Monthly spend over the last 12 months, ascending by month. */
  monthlySpend: MonthlySpend[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

function monthKey(date: string): string {
  return date.slice(0, 7) // 'YYYY-MM'
}

/**
 * Compute spending analytics on read from the store — no persisted cache.
 *
 * "Spend" = sum of `expense.amount` only. Settlements are repayments, not
 * purchases, so they are deliberately excluded (matching the ADR).
 *
 * Currency-agnostic: grouped purely by (month | category) so F7's conversion
 * step can be layered on later without rewriting this aggregation.
 */
export function computeAnalytics(expenses: Expense[]): AnalyticsSummary {
  const now = new Date()
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`

  // Last 12 months of buckets (ascending), seeded to zero so gaps show as 0.
  const monthlyMap = new Map<string, number>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthlyMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0)
  }

  const catMap = new Map<string, number>()

  let totalAllTime = 0
  let totalThisMonth = 0
  let totalLastMonth = 0

  for (const e of expenses) {
    const amt = e.amount || 0
    totalAllTime += amt

    const key = monthKey(e.date)
    if (key === nowKey) totalThisMonth += amt
    if (key === lastKey) totalLastMonth += amt
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + amt)

    const cat = normalizeCategory(e.category)
    catMap.set(cat, (catMap.get(cat) ?? 0) + amt)
  }

  const monthlySpend: MonthlySpend[] = Array.from(monthlyMap.entries())
    .map(([month, amount]) => ({ month, amount: round2(amount) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const byCategory: CategorySpend[] = Array.from(catMap.entries())
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)

  return {
    totalAllTime: round2(totalAllTime),
    totalThisMonth: round2(totalThisMonth),
    totalLastMonth: round2(totalLastMonth),
    expenseCount: expenses.length,
    byCategory,
    monthlySpend,
  }
}