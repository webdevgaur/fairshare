import { useState, useEffect } from 'react'
import { getActivityFeed, getCurrentUserId } from '@/lib/api'
import type { ActivityItem, ActivitySettlementItem, ActivityCommentItem, ActivityExpenseItem } from '@/lib/engine'
import { syncClient } from '@/lib/sync'
import { Card } from '@/components/ui/card'
import ExpenseComments from '@/components/ExpenseComments'

function formatCurrency(n: number) {
  return '$' + n.toFixed(2)
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function ExpenseFeedCard({
  item,
  groupId,
  onActivityChange,
}: {
  item: ActivityExpenseItem
  groupId: number
  onActivityChange?: () => void
}) {
  const currentUserId = getCurrentUserId()
  return (
    <Card className={`p-4 transition-all duration-150 hover:border-slate-300 hover:shadow-sm ${
      currentUserId && (item.user_id === currentUserId) ? 'border-l-4 border-l-slate-400' : ''
    }`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 truncate">{item.description}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            <span className="text-slate-500">
              {item.user_id === currentUserId ? 'You' : item.user_name}
            </span>
            <span className="text-slate-400 mx-1">·</span>
            <span>{item.date}</span>
            <span className="text-slate-300 mx-1">·</span>
            <span>{formatWhen(item.created_at)}</span>
          </p>
        </div>
        <p className="font-semibold text-slate-900 shrink-0 ml-2">{formatCurrency(item.amount)}</p>
      </div>
      {item.splits && item.splits.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-0.5">
          {item.splits.map((s) => (
            <div key={s.user_id} className="flex items-center justify-between text-xs py-0.5">
              <span className="text-slate-500">{formatCurrency(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <ExpenseComments expenseUuid={item.uuid} groupId={groupId} onActivityChange={onActivityChange} />
    </Card>
  )
}

function SettlementFeedCard({ item }: { item: ActivitySettlementItem }) {
  return (
    <Card className="p-4 flex items-center justify-between border-l-4 border-l-amber-400 hover:border-slate-300 hover:shadow-sm transition-all duration-150">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-lg">↩️</span>
        <div>
          <span className="font-medium text-slate-900">{item.from_user_name}</span>
          <span className="text-slate-400 mx-1">paid</span>
          <span className="font-medium text-slate-900">{item.to_user_name}</span>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold text-slate-900">{formatCurrency(item.amount)}</p>
        <p className="text-xs text-slate-400">{item.date}</p>
      </div>
    </Card>
  )
}

function CommentFeedLine({ item }: { item: ActivityCommentItem }) {
  return (
    <div
      className="flex items-start gap-2 px-1 py-1 text-sm"
      data-testid={`activity-comment-${item.id}`}
    >
      <span className="text-base leading-none mt-0.5">💬</span>
      <div className="min-w-0">
        <p className="text-slate-700">
          <span className="font-medium">{item.author_name}</span>{' '}
          <span className="text-slate-400">commented</span>
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{formatWhen(item.created_at)}</p>
      </div>
    </div>
  )
}

/** Group a sorted feed by the activity date (derived from created_at). */
function groupByDate(feed: ActivityItem[]) {
  const groups: { date: string; items: ActivityItem[] }[] = []
  for (const item of feed) {
    const date = item.created_at.slice(0, 10)
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.items.push(item)
    else groups.push({ date, items: [item] })
  }
  return groups
}

/**
 * Unified reverse-chronological activity feed for a group, merging expenses,
 * settlements, and comments. Re-reads the store whenever a sync patch arrives
 * so comments referencing not-yet-synced expenses appear once the expense lands.
 */
export default function ActivityFeed({ groupId }: { groupId: number }) {
  const [, setTick] = useState(0)
  const feed: ActivityItem[] = getActivityFeed(groupId)

  useEffect(() => {
    const unsub = syncClient.onPatch(() => setTick((t) => t + 1))
    return unsub
  }, [groupId])

  if (feed.length === 0) {
    return (
      <Card className="text-center py-12">
        <div className="text-3xl mb-3">🧾</div>
        <p className="text-slate-500 font-medium">No expenses yet</p>
        <p className="text-sm text-slate-400 mt-1">Tap "Add Expense" to split your first bill</p>
      </Card>
    )
  }

  const groups = groupByDate(feed)

  return (
    <div data-testid="activity-feed">
      {groups.map((g) => (
        <div key={g.date}>
          <div className="flex items-center gap-2 pt-4 first:pt-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {g.date}
            </span>
            <span className="flex-1 h-px bg-slate-100" />
          </div>
          <div className="space-y-2">
            {g.items.map((item) => {
              switch (item.kind) {
                case 'expense':
                  return (
                    <ExpenseFeedCard
                      key={`expense-${item.id}`}
                      item={item}
                      groupId={groupId}
                      onActivityChange={() => setTick((t) => t + 1)}
                    />
                  )
                case 'settlement':
                  return <SettlementFeedCard key={`settlement-${item.id}`} item={item} />
                case 'comment':
                  return <CommentFeedLine key={`comment-${item.id}`} item={item} />
              }
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
