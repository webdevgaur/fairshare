import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import type { ParsedLineItem, ParsedReceipt } from '@/lib/receipt-parser'

interface Member {
  id: string
  name: string
}

/**
 * Review-and-assign grid (F1).
 *
 * Shows the OCR-extracted line items as editable suggestion rows, lets the
 * user fix descriptions/amounts and assign each item to one or more group
 * members, then batch-creates all expenses with one tap. This grid is the
 * safety net for the heuristic parser's imperfection — the user corrects
 * before anything is committed.
 */
export default function ReceiptReview({
  receipt,
  members,
  onCreate,
  onCancel,
}: {
  receipt: ParsedReceipt
  members: Member[]
  onCreate: (items: ParsedLineItem[], assignments: string[][], opts: { date?: string }) => void
  onCancel: () => void
}) {
  const allMemberIds = members.map((m) => m.id)
  const [descriptions, setDescriptions] = useState<string[]>(receipt.items.map((i) => i.description))
  const [amounts, setAmounts] = useState<string[]>(receipt.items.map((i) => String(i.amount)))
  const [assignments, setAssignments] = useState<string[][]>(
    receipt.items.map(() => [...allMemberIds]),
  )
  const [date, setDate] = useState<string>(receipt.date ?? new Date().toISOString().slice(0, 10))

  function setDesc(i: number, v: string) {
    setDescriptions((prev) => prev.map((d, idx) => (idx === i ? v : d)))
  }
  function setAmount(i: number, v: string) {
    setAmounts((prev) => prev.map((a, idx) => (idx === i ? v : a)))
  }
  function toggleMember(i: number, memberId: string) {
    setAssignments((prev) =>
      prev.map((assigned, idx) => {
        if (idx !== i) return assigned
        return assigned.includes(memberId)
          ? assigned.filter((id) => id !== memberId)
          : [...assigned, memberId]
      }),
    )
  }

  function handleCreate() {
    const items: ParsedLineItem[] = []
    const outAssignments: string[][] = []
    for (let i = 0; i < descriptions.length; i++) {
      const amount = parseFloat(amounts[i])
      if (!descriptions[i].trim() || !amount || amount <= 0) continue
      items.push({ description: descriptions[i].trim(), amount })
      // Empty assignment → split across everyone.
      outAssignments.push(assignments[i].length > 0 ? assignments[i] : [...allMemberIds])
    }
    onCreate(items, outAssignments, { date })
  }

  return (
    <Card className="mb-4 p-4" data-testid="receipt-review">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Review &amp; assign</h3>
          <span className="text-xs text-slate-400">{receipt.merchant ?? 'Receipt'}</span>
        </div>

        {receipt.items.length === 0 ? (
          <p className="text-xs text-slate-400">No line items were recognised — you can still add an expense manually.</p>
        ) : (
          <div className="space-y-3">
            {descriptions.map((desc, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2.5 space-y-2" data-testid={`receipt-item-${i}`}>
                <div className="flex gap-2">
                  <Input
                    value={desc}
                    onChange={(e) => setDesc(i, e.target.value)}
                    placeholder="Item"
                    data-testid={`receipt-item-desc-${i}`}
                  />
                  <Input
                    value={amounts[i]}
                    onChange={(e) => setAmount(i, e.target.value)}
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-28"
                    placeholder="0.00"
                    data-testid={`receipt-item-amount-${i}`}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const selected = assignments[i].includes(m.id)
                    return (
                      <Button
                        key={m.id}
                        type="button"
                        size="xs"
                        variant={selected ? 'default' : 'secondary'}
                        onClick={() => toggleMember(i, m.id)}
                        data-testid={`receipt-assign-${i}-${m.id}`}
                      >
                        {selected ? '✓ ' : ''}{m.name}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Date</label>
              <Input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="w-40"
                data-testid="receipt-review-date"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCreate} data-testid="receipt-create-all">
                Create all ({descriptions.length})
              </Button>
              <Button variant="ghost" onClick={onCancel} data-testid="receipt-review-cancel">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
