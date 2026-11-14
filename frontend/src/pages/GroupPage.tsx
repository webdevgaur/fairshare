import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import React from 'react'
import {
  getGroup,
  getGroupBalances,
  getGroupMembers,
  createExpense,
  createExpenseFromScan,
  createSettlement,
  getCurrentUserId,
  getSuggestedSettlements,
  getUserPaymentHandles,
  CATEGORIES,
} from '../lib/api'
import type { BalanceEntry, Transaction } from '../lib/api'
import { buildPaymentLink, type PaymentProvider } from '../lib/paymentLinks'
import ActivityFeed from '@/components/ActivityFeed'
import ReceiptScanner from '@/components/ReceiptScanner'
import ReceiptReview from '@/components/ReceiptReview'
import { parseReceipt, type ParsedReceipt, type ParsedLineItem } from '../lib/receipt-parser'
import { putReceipt } from '../lib/receipt-store'
import type { OcrResult } from '../lib/receipt-parser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

interface Member {
  id: string
  name: string
}

function formatCurrency(n: number) {
  return '$' + n.toFixed(2)
}

const providerLabels: Record<PaymentProvider, string> = {
  venmo: 'Venmo',
  paypal: 'PayPal',
  cashapp: 'Cash App',
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export default function GroupPage() {
  const { id } = useParams<{ id: string }>()
  const groupId = Number(id)

  const [group, setGroup] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [balances, setBalances] = useState<BalanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showBalances, setShowBalances] = useState(false)

  // Expense form
  const [showExpense, setShowExpense] = useState(false)
  const [expDesc, setExpDesc] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expCategory, setExpCategory] = useState('')
  const [expSplits, setExpSplits] = useState<'equal' | 'custom'>('equal')
  const [expCustomSplits, setExpCustomSplits] = useState<Record<string, string>>({})
  const [expCustomError, setExpCustomError] = useState('')

  // Settlement form
  const [showSettle, setShowSettle] = useState(false)
  const [settleFrom, setSettleFrom] = useState('')
  const [settleTo, setSettleTo] = useState('')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleProvider, setSettleProvider] = useState<PaymentProvider>('venmo')
  const [suggestedTxns, setSuggestedTxns] = useState<Transaction[]>([])

  // Receipt scan flow (F1)
  const [scanStage, setScanStage] = useState<'idle' | 'capture' | 'review'>('idle')
  const [scanImage, setScanImage] = useState<Blob | null>(null)
  const [scanParsed, setScanParsed] = useState<ParsedReceipt | null>(null)

  const currentUserId = getCurrentUserId()

  function loadData() {
    const g = getGroup(groupId)
    const m = getGroupMembers(groupId)
    const b = getGroupBalances(groupId)

    setGroup(g)
    setMembers(m)
    setBalances(b.balances)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  function handleAddExpense(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(expAmount)
    if (!expDesc.trim() || !amount || amount <= 0) return

    if (expSplits === 'custom') {
      const entries = members.map((m) => ({
        member: m,
        raw: expCustomSplits[m.id] ?? '',
      }))

      const filled = entries.filter((e) => e.raw.trim() !== '')
      if (filled.length > 0) {
        const parsed = filled.map((e) => ({
          user_id: e.member.id,
          amount: parseFloat(e.raw),
        }))
        const sum = parsed.reduce((acc, s) => acc + s.amount, 0)
        if (Math.abs(sum - amount) > 0.01) {
          setExpCustomError(
            `Custom splits must total $${amount.toFixed(2)} (currently $${sum.toFixed(2)})`
          )
          return
        }
        setExpCustomError('')
        createExpense({
          group_id: groupId,
          amount,
          description: expDesc,
          category: expCategory || undefined,
          splits: parsed,
        })
      } else {
        // All empty — fall back to equal split
        createExpense({
          group_id: groupId,
          amount,
          description: expDesc,
          category: expCategory || undefined,
          splits: members.map((m) => ({ user_id: m.id })),
        })
      }
    } else {
      createExpense({
        group_id: groupId,
        amount,
        description: expDesc,
        category: expCategory || undefined,
        splits: members.map((m) => ({ user_id: m.id })),
      })
    }

    // Reload data
    setBalances(getGroupBalances(groupId).balances)
    setShowExpense(false)
    setExpDesc('')
    setExpAmount('')
    setExpCategory('')
    setExpCustomSplits({})
    setExpCustomError('')
  }

  function handleSettle(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(settleAmount)
    if (!settleFrom || !settleTo || !amount || amount <= 0) return

    createSettlement({
      group_id: groupId,
      from_user: settleFrom,
      to_user: settleTo,
      amount,
    })

    // Reload data
    setBalances(getGroupBalances(groupId).balances)
    setShowSettle(false)
    setSettleFrom('')
    setSettleTo('')
    setSettleAmount('')
  }

  function handleSuggest() {
    const txns = getSuggestedSettlements(groupId)
    setSuggestedTxns(txns)
    if (txns.length === 1) {
      const t = txns[0]
      setSettleFrom(t.from_user)
      setSettleTo(t.to_user)
      setSettleAmount(String(t.amount))
      setShowSettle(true)
    }
  }

  function handleScan(image: Blob, result: OcrResult) {
    const parsed = parseReceipt(result)
    setScanImage(image)
    setScanParsed(parsed)
    setScanStage('review')
  }

  function handleScanCreate(items: ParsedLineItem[], assignments: string[][], opts: { date?: string }) {
    const created = createExpenseFromScan(groupId, items, assignments, { date: opts.date })
    // Persist the image in IndexedDB (best-effort — the structured expense is
    // the source of truth; a failed image write must not block creation).
    if (scanImage) {
      const scanId = crypto.randomUUID()
      void putReceipt({
        id: scanId,
        groupId,
        createdAt: new Date().toISOString(),
        image: scanImage,
        merchant: scanParsed?.merchant,
        date: opts.date,
        expenseUuids: created.map((e) => e.uuid),
      }).catch(() => {})
    }
    setBalances(getGroupBalances(groupId).balances)
    setScanStage('idle')
    setScanImage(null)
    setScanParsed(null)
  }

  function handleScanCancel() {
    setScanStage('idle')
    setScanImage(null)
    setScanParsed(null)
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-shimmer">
        <div className="h-8 bg-slate-200 rounded w-48" />
        <div className="h-4 bg-slate-100 rounded w-32" />
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
      </div>
    )
  }

  if (!group) return <p className="text-slate-400">Group not found</p>

  const myBalance = balances.find((b) => b.user_id === currentUserId)?.balance ?? 0

  const settleAmountNum = parseFloat(settleAmount)
  const recipHandles = settleTo ? getUserPaymentHandles(settleTo) : null
  const payLink = settleTo && settleAmountNum > 0
    ? buildPaymentLink(settleProvider, {
        username: recipHandles?.venmo_username ?? null,
        paypal_handle: recipHandles?.paypal_handle ?? null,
        cashtag: recipHandles?.cashapp_cashtag ?? null,
        amount: settleAmountNum,
        memo: 'FairShare settlement',
      })
    : null

  return (
    <div className="animate-fade-in">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          aria-label="Back to dashboard"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{group.name}</h1>
          {group.description && <p className="text-sm text-slate-400">{group.description}</p>}
        </div>
      </div>

      {/* Per-group summary pill */}
      {myBalance !== 0 && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium ${
          myBalance > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {myBalance > 0
            ? `You're owed ${formatCurrency(myBalance)} overall`
            : `You owe ${formatCurrency(Math.abs(myBalance))} overall`}
        </div>
      )}

      {/* Collapsible balances accordion */}
      <Card className="mb-4 overflow-hidden">
        <Button
          variant="ghost"
          onClick={() => setShowBalances(!showBalances)}
          className="w-full flex items-center justify-between p-4 rounded-none h-auto"
        >
          <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span className="inline-block w-0.5 h-3.5 rounded-full bg-green-300" />
            Balances
          </h2>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showBalances ? 'rotate-180' : ''}`} />
        </Button>
        <div className={`overflow-hidden transition-all duration-200 ${showBalances ? 'max-h-96' : 'max-h-0'}`}>
          <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3">
            {balances.map((b) => (
              <div key={b.user_id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">
                  {b.user_id === currentUserId ? 'You' : b.user_name}
                </span>
                <span
                  className={
                    b.balance > 0
                      ? 'text-green-600 font-medium'
                      : b.balance < 0
                        ? 'text-rose-600 font-medium'
                        : 'text-slate-400'
                  }
                >
                  {b.balance === 0
                    ? 'settled'
                    : b.balance > 0
                      ? `+${formatCurrency(b.balance)}`
                      : `-${formatCurrency(Math.abs(b.balance))}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Suggest settlement */}
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <Button variant="outline" size="sm" onClick={handleSuggest} className="w-full">
            ✨ Suggest settlement
          </Button>

          {suggestedTxns.length > 1 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-slate-500">Tap "Use" to prefill a settlement</p>
              {suggestedTxns.map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5">
                  <span className="text-sm text-slate-700">
                    {t.from_user_name} pays {t.to_user_name} {formatCurrency(t.amount)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSettleFrom(t.from_user)
                      setSettleTo(t.to_user)
                      setSettleAmount(String(t.amount))
                      setShowSettle(true)
                    }}
                  >
                    Use
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Button
          onClick={() => setShowExpense(!showExpense)}
          className="w-full sm:flex-1"
        >
          + Add Expense
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowSettle(!showSettle)}
          className="w-full sm:flex-1 bg-white"
        >
          Settle Up
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setShowExpense(false)
            setShowSettle(false)
            setScanStage('capture')
          }}
          className="w-full sm:flex-1 bg-white"
          data-testid="scan-receipt-button"
        >
          Scan Receipt
        </Button>
      </div>

      {/* Receipt scan flow (F1) */}
      {scanStage === 'capture' && (
        <ReceiptScanner onScan={handleScan} onCancel={handleScanCancel} />
      )}
      {scanStage === 'review' && scanParsed && (
        <ReceiptReview
          receipt={scanParsed}
          members={members}
          onCreate={handleScanCreate}
          onCancel={handleScanCancel}
        />
      )}

      {/* Add expense form */}
      {showExpense && (
        <Card className="mb-4">
          <form onSubmit={handleAddExpense} className="p-4 space-y-3">
            <Input
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="What for?"
              autoFocus
            />
            <Input
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount"
            />
            <Select value={expCategory} onValueChange={(v) => setExpCategory(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Category (optional)" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={expSplits === 'equal' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setExpSplits('equal')}
              >
                Equal
              </Button>
              <Button
                type="button"
                variant={expSplits === 'custom' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setExpSplits('custom')}
              >
                Custom
              </Button>
            </div>
            {expSplits === 'custom' && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">Custom splits</p>
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <span className="text-sm text-slate-700 w-24 truncate">{m.name}</span>
                    <Input
                      value={expCustomSplits[m.id] ?? ''}
                      onChange={(e) =>
                        setExpCustomSplits((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                ))}
                {expCustomError && (
                  <p className="text-xs text-rose-500">{expCustomError}</p>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit">
                Add
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowExpense(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Settle form */}
      {showSettle && (
        <Card className="mb-4">
          <form onSubmit={handleSettle} className="p-4 space-y-3">
            <Select
              value={settleFrom}
              onValueChange={(value) => setSettleFrom(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Who's paying?" />
              </SelectTrigger>
              <SelectContent>
                {balances
                  .filter((b) => b.balance < 0)
                  .map((b) => (
                    <SelectItem key={b.user_id} value={b.user_id}>
                      {b.user_name} owes {formatCurrency(Math.abs(b.balance))}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={settleTo}
              onValueChange={(value) => setSettleTo(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Who's getting paid?" />
              </SelectTrigger>
              <SelectContent>
                {balances
                  .filter((b) => b.balance > 0)
                  .map((b) => (
                    <SelectItem key={b.user_id} value={b.user_id}>
                      {b.user_name} is owed {formatCurrency(b.balance)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount"
            />
            <div className="flex gap-2">
              {(['venmo', 'paypal', 'cashapp'] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={settleProvider === p ? 'default' : 'secondary'}
                  onClick={() => setSettleProvider(p)}
                >
                  {providerLabels[p]}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">
                I Paid — Record Payment
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!payLink}
                onClick={() => payLink && window.open(payLink, '_blank', 'noopener')}
              >
                Pay with {providerLabels[settleProvider]}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowSettle(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Unified activity feed */}
      <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        <span className="inline-block w-0.5 h-3.5 rounded-full bg-slate-300" />
        Activity
      </h2>
      <ActivityFeed groupId={groupId} />
    </div>
  )
}