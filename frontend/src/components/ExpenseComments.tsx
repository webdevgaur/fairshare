import { useState, useEffect } from 'react'
import { getExpenseComments, createComment, getCurrentUserId } from '@/lib/api'
import type { Comment } from '@/lib/api'
import { syncClient } from '@/lib/sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function formatWhen(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Expandable comment thread attached to an expense card. Comments reference
 * the expense by its stable `uuid`, so they attach to the same expense on
 * every device. Re-reads the store on each render and refreshes when a sync
 * patch arrives (reconciliation).
 */
export default function ExpenseComments({
  expenseUuid,
  groupId,
  onActivityChange,
}: {
  expenseUuid: string
  groupId: number
  onActivityChange?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  // Bump to force a re-read of the store after posting or after a sync patch.
  const [, setTick] = useState(0)
  const currentUserId = getCurrentUserId()

  const comments: Comment[] = getExpenseComments(expenseUuid)

  // Re-render when a remote comment/expense patch lands (reconciliation).
  useEffect(() => {
    const unsub = syncClient.onPatch(() => setTick((t) => t + 1))
    return unsub
  }, [])

  function handlePost() {
    const text = draft.trim()
    if (!text) return
    createComment(groupId, expenseUuid, text)
    setDraft('')
    setTick((t) => t + 1)
    onActivityChange?.()
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-100" data-testid={`expense-comments-${expenseUuid}`}>
      <Button
        variant="ghost"
        size="sm"
        className="text-slate-400 hover:text-slate-600 -ml-2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid={`expense-comments-toggle-${expenseUuid}`}
      >
        💬{' '}
        {comments.length === 0
          ? 'Comment'
          : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
      </Button>

      {open && (
        <div className="mt-2 space-y-2">
          {comments.length === 0 ? (
            <p className="text-xs text-slate-400">No comments yet</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-sm" data-testid={`comment-${c.id}`}>
                <span className="font-medium text-slate-700">
                  {c.author_id === currentUserId ? 'You' : c.author_name}
                </span>
                <span className="text-xs text-slate-400 ml-1.5">{formatWhen(c.created_at)}</span>
                <p className="text-slate-600 mt-0.5">{c.text}</p>
              </div>
            ))
          )}

          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment..."
              data-testid={`comment-input-${expenseUuid}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handlePost()
                }
              }}
            />
            <Button size="sm" onClick={handlePost} data-testid={`comment-post-${expenseUuid}`}>
              Post
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
