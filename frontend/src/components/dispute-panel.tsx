import { useState, useEffect } from 'react'
import { getPendingDisputes, acceptDispute, rejectDispute, getCurrentUserId } from '@/lib/api'
import type { Dispute, Expense } from '@/lib/engine'
import { Button } from '@/components/ui/button'

function formatCurrency(n: number) {
  return '$' + n.toFixed(2)
}

/** Format a relative timestamp for the dispute card header. */
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

/** A single pending dispute card showing proposer, original expense, proposed changes, and vote controls. */
function DisputeCard({
  dispute,
  expense,
  currentUserId,
  onVote,
}: {
  dispute: Dispute
  expense: Expense | undefined
  currentUserId: string | null
  onVote: (disputeUuid: string, action: 'accept' | 'reject') => void
}) {
  const votedAccept = currentUserId && dispute.acceptances.includes(currentUserId)
  const votedReject = currentUserId && dispute.rejections.includes(currentUserId)
  const hasVoted = !!(votedAccept || votedReject)
  const isInAcceptanceSet = currentUserId && dispute.acceptance_set.includes(currentUserId)
  const showVoteButtons = !hasVoted && isInAcceptanceSet

  const progress = `${dispute.acceptances.length}/${dispute.acceptance_set.length} members accepted`

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid="dispute-card">
      {/* Proposer + timestamp */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-slate-900">⚖️ {dispute.proposer_name}</span>
        <span className="text-xs text-slate-400">{formatRelativeTime(dispute.created_at)}</span>
      </div>

      {/* Original expense */}
      {expense && (
        <div className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">Original:</span>{' '}
          {expense.description} — {formatCurrency(expense.amount)}
          <div className="text-slate-400">paid by {expense.paid_by_name} · {expense.date}</div>
        </div>
      )}

      {/* Proposed total */}
      {dispute.proposed_total != null && (
        <div className="text-xs">
          <span className="font-medium text-slate-600">Proposed total:</span>{' '}
          <span className="text-slate-700">{formatCurrency(dispute.proposed_total)}</span>
        </div>
      )}

      {/* Proposed splits */}
      {dispute.proposed_splits && dispute.proposed_splits.length > 0 && (
        <div className="text-xs">
          <span className="font-medium text-slate-600">Proposed split:</span>
          <ul className="list-disc pl-4 mt-0.5 text-slate-600">
            {dispute.proposed_splits.map((s) => (
              <li key={s.user_id}>
                {s.user_name}: {formatCurrency(s.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Progress */}
      <div className="text-xs text-slate-400">{progress}</div>

      {/* Vote status / action buttons */}
      <div className="flex gap-2 items-center pt-1">
        {votedAccept ? (
          <span className="text-xs font-medium text-green-600">✅ You accepted</span>
        ) : votedReject ? (
          <span className="text-xs font-medium text-rose-500">❌ You rejected</span>
        ) : showVoteButtons ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVote(dispute.uuid, 'accept')}
              className="min-h-[44px]"
            >
              ✅ Accept
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onVote(dispute.uuid, 'reject')}
              className="min-h-[44px]"
            >
              ❌ Reject
            </Button>
          </>
        ) : currentUserId ? (
          <span className="text-xs text-slate-400">Awaiting votes from other members</span>
        ) : (
          <span className="text-xs text-slate-400">Sign in to vote</span>
        )}
      </div>
    </div>
  )
}

/**
 * DisputePanel — shows all pending disputes for a group with accept/reject controls.
 *
 * @param groupId  - The group id to load disputes for.
 * @param expenses - The current expense list (used to look up original expense details).
 * @param onDisputeResolved - Callback fired after any vote/dispute resolution for the parent to refresh.
 */
export default function DisputePanel({
  groupId,
  expenses,
  onDisputeResolved,
}: {
  groupId: number
  expenses: Expense[]
  onDisputeResolved: () => void
}) {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const currentUserId = getCurrentUserId()

  function loadDisputes() {
    setDisputes(getPendingDisputes(groupId))
    setLoading(false)
  }

  useEffect(() => {
    loadDisputes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  function handleVote(disputeUuid: string, action: 'accept' | 'reject') {
    if (action === 'accept') {
      acceptDispute(disputeUuid)
    } else {
      rejectDispute(disputeUuid)
    }
    loadDisputes()
    onDisputeResolved()
  }

  if (loading || disputes.length === 0) return null

  return (
    <div data-testid="dispute-panel" className="space-y-2 mt-6">
      <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">
        Pending Disputes
      </h2>
      {disputes.map((d) => {
        const expense = expenses.find((e) => e.uuid === d.expense_uuid)
        return (
          <DisputeCard
            key={d.uuid}
            dispute={d}
            expense={expense}
            currentUserId={currentUserId}
            onVote={handleVote}
          />
        )
      })}
    </div>
  )
}