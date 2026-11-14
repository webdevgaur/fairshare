import { store } from './store'
import type { ActivityItem } from './engine'

/**
 * Build the unified, reverse-chronological activity feed for a group by
 * merging expenses, settlements, and comments, sorted by creation time
 * (most recent first).
 *
 * Reconciliation: comments that reference an expense which has not yet
 * synced to this device (no matching `expense_uuid`) are omitted from the
 * feed. They are retained in the store and appear once the expense arrives.
 */
export function buildActivityFeed(groupId: number): ActivityItem[] {
  const expenses = store.getGroupExpenses(groupId)
  const settlements = store.getGroupSettlements(groupId)
  const comments = store.getGroupComments(groupId)

  const expenseUuids = new Set(expenses.map((e) => e.uuid))

  /** ISO date string or fallback to date-only for legacy records. */
  function sortableTs(r: { created_at?: string; date?: string }): string {
    return r.created_at ?? (r.date ? r.date + 'T00:00:00.000Z' : '')
  }

  const items: ActivityItem[] = []

  for (const exp of expenses) {
    items.push({
      kind: 'expense',
      id: exp.id,
      uuid: exp.uuid,
      group_id: exp.group_id,
      user_id: exp.paid_by,
      user_name: exp.paid_by_name,
      description: exp.description,
      amount: exp.amount,
      date: exp.date,
      created_at: exp.created_at,
      splits: exp.splits,
    })
  }

  for (const s of settlements) {
    items.push({
      kind: 'settlement',
      id: s.id,
      group_id: s.group_id,
      from_user: s.from_user,
      from_user_name: s.from_user_name,
      to_user: s.to_user,
      to_user_name: s.to_user_name,
      amount: s.amount,
      date: s.date,
      created_at: s.created_at,
    })
  }

  for (const c of comments) {
    // Skip comments whose referenced expense hasn't arrived yet.
    if (!expenseUuids.has(c.expense_uuid)) continue
    items.push({
      kind: 'comment',
      id: c.id,
      group_id: c.group_id,
      expense_uuid: c.expense_uuid,
      expense_id: c.expense_id,
      author_id: c.author_id,
      author_name: c.author_name,
      text: c.text,
      created_at: c.created_at,
    })
  }

  // Sort reverse-chronologically by creation time, then by kind for a
  // deterministic tie-break (JS sort is stable).
  const kindOrder: Record<ActivityItem['kind'], number> = {
    expense: 0,
    settlement: 1,
    comment: 2,
  }
  items.sort((a, b) => {
    const diff = new Date(sortableTs(b)).getTime() - new Date(sortableTs(a)).getTime()
    if (diff !== 0) return diff
    return (kindOrder[a.kind] ?? 0) - (kindOrder[b.kind] ?? 0)
  })

  return items
}
