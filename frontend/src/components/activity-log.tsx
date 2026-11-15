import { useState, useEffect } from 'react'
import { getGroupActivityLog, getExpenses, getCurrentUserId } from '@/lib/api'
import type { ActivityLogEntry, ActivityType, ExpenseSplit } from '@/lib/engine'
import { syncClient } from '@/lib/sync'
import { Card } from '@/components/ui/card'

function formatCurrency(n: number) {
  return '$' + n.toFixed(2)
}

/**
 * Format a relative timestamp: "now", "2m ago", "1h ago", "3d ago",
 * or the date string (e.g., "Nov 14") for older entries.
 */
function formatRelativeTime(iso: string) {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 10) return 'now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  const d = new Date(iso)
  const month = d.toLocaleString(undefined, { month: 'short' })
  const day = d.getDate()
  return `${month} ${day}`
}

/** Map an activity type to a human-readable action label. */
function actionLabel(type: ActivityType): string {
  switch (type) {
    case 'expense_added':
      return 'added expense'
    case 'settlement_created':
      return 'settled up'
    case 'expense_deleted':
      return 'deleted expense'
    case 'dispute_created':
      return 'disputed expense'
    case 'dispute_resolved':
      return 'dispute resolved'
    case 'comment_added':
      return 'commented'
    default:
      return 'acted'
  }
}

/** Icon for each activity type. */
function actionIcon(type: ActivityType): string {
  switch (type) {
    case 'expense_added':
      return '💰'
    case 'settlement_created':
      return '↩️'
    case 'expense_deleted':
      return '🗑️'
    case 'dispute_created':
      return '⚠️'
    case 'dispute_resolved':
      return '✅'
    case 'comment_added':
      return '💬'
    default:
      return '📋'
  }
}

/** Resolve the expense description and splits for an expense_added entry. */
function findExpenseSplits(
  groupId: number,
  entityUuid?: string | null,
): { description: string; splits: ExpenseSplit[] } | null {
  if (!entityUuid) return null
  const expenses = getExpenses(groupId)
  const expense = expenses.find((e) => e.uuid === entityUuid)
  if (!expense) return null
  return { description: expense.description, splits: expense.splits }
}

/** A single activity log entry card. */
function ActivityLogEntryCard({
  entry,
  groupId,
}: {
  entry: ActivityLogEntry
  groupId: number
}) {
  const currentUserId = getCurrentUserId()
  const isSelf = currentUserId && entry.actor_id === currentUserId
  const actor = isSelf ? 'You' : entry.actor_name
  const action = actionLabel(entry.type)
  const icon = actionIcon(entry.type)

  let expenseInfo: { description: string; splits: ExpenseSplit[] } | null = null
  let commentSnippet: string | null = null

  if (entry.type === 'expense_added') {
    expenseInfo = findExpenseSplits(groupId, entry.entity_uuid)
  } else if (entry.type === 'comment_added') {
    commentSnippet = (entry.payload?.text as string) ?? null
  }

  return (
    <Card className="p-4 transition-all duration-150 hover:border-slate-300 hover:shadow-sm">
      <div className="flex items-start gap-3 min-h-[44px]">
        <span className="text-xl leading-none shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{actor}</span>
            <span className="text-slate-400 mx-1">{action}</span>
          </p>
          {expenseInfo && (
            <div className="mt-1">
              <p className="font-semibold text-slate-900 text-sm">
                {expenseInfo.description}
              </p>
              {expenseInfo.splits.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {expenseInfo.splits.map((s) => (
                    <div key={s.user_id} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-slate-500">{s.user_name}</span>
                      <span className="text-slate-500">{formatCurrency(s.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {commentSnippet !== null && (
            <p className="text-xs text-slate-400 mt-1 italic line-clamp-2">
              "{commentSnippet}"
            </p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            {formatRelativeTime(entry.created_at)}
          </p>
        </div>
      </div>
    </Card>
  )
}

/**
 * Full-screen activity log for a group.
 * Renders entries in reverse-chronological order (newest first).
 */
export default function ActivityLog({ groupId }: { groupId: number }) {
  const [, setTick] = useState(0)
  const entries: ActivityLogEntry[] = getGroupActivityLog(groupId)

  useEffect(() => {
    const unsub = syncClient.onPatch(() => setTick((t) => t + 1))
    return unsub
  }, [groupId])

  if (entries.length === 0) {
    return (
      <Card className="text-center py-12">
        <div className="text-3xl mb-3">📋</div>
        <p className="text-slate-500 font-medium">No activity yet</p>
        <p className="text-sm text-slate-400 mt-1">
          Activity will appear here as members add expenses, settle up, and comment
        </p>
      </Card>
    )
  }

  // Reverse-chronological: newest first
  const sorted = [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div data-testid="activity-log" className="space-y-2">
      {sorted.map((entry) => (
        <ActivityLogEntryCard
          key={`activity-${entry.uuid}`}
          entry={entry}
          groupId={groupId}
        />
      ))}
    </div>
  )
}