import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import React from 'react'
import {
  getGroup,
  getGroupBalances,
  getGroupMembers,
  getExpenses,
  deleteExpense,
  createExpense,
  createExpenseFromScan,
  createSettlement,
  getCurrentUserId,
  getSuggestedSettlements,
  getUserPaymentHandles,
  getCoupleForUser,
  getGroupCoupleMode,
  setGroupCoupleMode,
  CATEGORIES,
  createInviteForGroup,
  getPendingInvitesForGroup,
  acceptInvite,
  declineInvite,
  createDispute,
  getPendingDisputes,
} from '../lib/api'
import type { BalanceEntry, Transaction, PendingInviteRecord, Expense } from '../lib/api'
import { buildPaymentLink, type PaymentProvider } from '../lib/paymentLinks'
import { encodeInviteQR, buildInviteLink } from '../lib/invites'
import QrCode from '@/components/qr-code'
import ActivityLog from '@/components/activity-log'
import ReceiptScanner from '@/components/ReceiptScanner'
import ReceiptReview from '@/components/ReceiptReview'
import ConfirmDialog from '@/components/confirm-dialog'
import DisputePanel from '@/components/dispute-panel'
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

/** shadcn/ui Switch-style toggle (single element, accessible via role="switch"). */
function Switch({ toggled, onChange }: { toggled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={toggled}
      aria-label="Couple mode"
      data-testid="couple-mode-toggle"
      onClick={() => onChange(!toggled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${
        toggled ? 'bg-slate-900' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${toggled ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
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
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [deletingExpense, setDeletingExpense] = useState<string | null>(null)

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

  // Couple mode (F9)
  const [showCoupleToggle, setShowCoupleToggle] = useState(false)
  const [coupleMode, setCoupleMode] = useState(false)

  // Invite (F8)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteToken, setInviteToken] = useState('')
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRecord[]>([])
  const [inviteCopied, setInviteCopied] = useState(false)

  // Receipt scan flow (F1)
  const [scanStage, setScanStage] = useState<'idle' | 'capture' | 'review'>('idle')
  const [scanImage, setScanImage] = useState<Blob | null>(null)
  const [scanParsed, setScanParsed] = useState<ParsedReceipt | null>(null)
  const [activeTab, setActiveTab] = useState<'expenses' | 'activity'>('expenses')

  // Dispute form (F12)
  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const [disputeExp, setDisputeExp] = useState<Expense | null>(null)
  const [disputeTotal, setDisputeTotal] = useState('')
  const [disputeSplits, setDisputeSplits] = useState<Record<string, string>>({})
  const [disputeError, setDisputeError] = useState('')

  const currentUserId = getCurrentUserId()

  function loadData() {
    const g = getGroup(groupId)
    const m = getGroupMembers(groupId)
    const b = getGroupBalances(groupId)

    setGroup(g)
    setMembers(m)
    setBalances(b.balances)
    setExpenses(getExpenses(groupId))

    // Couple-mode toggle availability (F9): only offered when the current
    // user is registered in a couple AND their partner is a member here.
    const me = currentUserId
    const couple = me ? getCoupleForUser(me) : undefined
    if (couple && me) {
      const partnerId = couple.user_a === me ? couple.user_b : couple.user_a
      const partnerInGroup = m.some((mem) => mem.id === partnerId)
      setShowCoupleToggle(partnerInGroup)
      if (partnerInGroup) setCoupleMode(getGroupCoupleMode(groupId))
    } else {
      setShowCoupleToggle(false)
    }

    setLoading(false)
    loadInvites()
  }

  function loadInvites() {
    setPendingInvites(getPendingInvitesForGroup(groupId))
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

  function handleToggleCoupleMode(enabled: boolean) {
    setGroupCoupleMode(groupId, enabled)
    setCoupleMode(enabled)
    // Refresh any already-shown suggestions to reflect the new netting.
    if (suggestedTxns.length > 0) setSuggestedTxns(getSuggestedSettlements(groupId))
  }

  function handleShowInvite() {
    // Create an open invite (no specific invitee) so there's a record for the link
    const record = createInviteForGroup(groupId)
    // Use the token FROM the store record so the link matches what's saved
    setInviteToken(record.token)
    loadInvites()
    setShowInvite(true)
  }

  function handleCopyInviteLink() {
    if (!inviteToken) return
    const link = buildInviteLink(inviteToken)
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    }).catch(() => {
      // Fallback: select-all + copy guidance
      setInviteCopied(true)
    })
  }

  function handleAcceptInvite(inviteUuid: string) {
    if (!currentUserId) return
    acceptInvite(inviteUuid, currentUserId)
    loadInvites()
    // Reload group data to reflect new member
    loadData()
  }

  function handleDeclineInvite(inviteUuid: string) {
    declineInvite(inviteUuid)
    loadInvites()
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

  // ─── F12 Expense Dispute handlers ───

  function handleOpenDispute(expense: Expense) {
    setDisputeExp(expense)
    setDisputeTotal('')
    const prefill: Record<string, string> = {}
    for (const s of expense.splits) {
      prefill[s.user_id] = String(s.amount)
    }
    setDisputeSplits(prefill)
    setDisputeError('')
    setShowDisputeForm(true)
  }

  function handleSubmitDispute() {
    if (!disputeExp) return

    const proposedTotal = disputeTotal.trim() ? parseFloat(disputeTotal) : undefined
    const fillable = members.map((m) => ({ id: m.id, raw: disputeSplits[m.id] ?? '' }))
    const filled = fillable.filter((s) => s.raw.trim() !== '')
    const proposedSplits = filled.length > 0
      ? filled.map((s) => {
          const member = members.find((m) => m.id === s.id)
          return { user_id: s.id, user_name: member?.name ?? 'Unknown', amount: parseFloat(s.raw) }
        })
      : undefined

    if (proposedTotal === undefined && proposedSplits === undefined) {
      setDisputeError('Provide an alternative total or at least one split amount.')
      return
    }

    if (proposedTotal !== undefined && (isNaN(proposedTotal) || proposedTotal <= 0)) {
      setDisputeError('Total must be a positive number.')
      return
    }
    if (proposedSplits !== undefined) {
      for (const s of proposedSplits) {
        if (isNaN(s.amount) || s.amount < 0) {
          setDisputeError('Invalid amount in split.')
          return
        }
      }
    }

    try {
      createDispute(groupId, disputeExp.uuid, proposedTotal, proposedSplits)
    } catch (e) {
      setDisputeError((e as Error).message)
      return
    }

    setShowDisputeForm(false)
    setDisputeExp(null)
    setDisputeTotal('')
    setDisputeSplits({})
    setDisputeError('')
    setExpenses(getExpenses(groupId))
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

  const pendingDisputes = getPendingDisputes(groupId)
  const disputedExpenseUuids = new Set(pendingDisputes.map((d) => d.expense_uuid))

  function handleDisputeResolved() {
    setExpenses(getExpenses(groupId))
  }

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

      {/* Tab: Expenses / Activity */}
      <div className="flex border-b border-slate-200" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'expenses'}
          onClick={() => setActiveTab('expenses')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'expenses'
              ? 'text-slate-900 border-b-2 border-slate-900'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          Expenses
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'activity'}
          onClick={() => setActiveTab('activity')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'activity'
              ? 'text-slate-900 border-b-2 border-slate-900'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          Activity
        </button>
      </div>

      <div className={activeTab === 'expenses' ? '' : 'hidden'}>
        {/* Invite member (F8) */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          variant="outline"
          onClick={handleShowInvite}
          data-testid="invite-member-button"
        >
          Invite Member
        </Button>
      </div>

      {showInvite && (
        <Card className="mb-4 p-4">
          <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Invite Member</h2>

          {/* Invite QR */}
          {inviteToken && (
            <div className="flex justify-center mb-3">
              <QrCode data={encodeInviteQR(inviteToken)} size={180} />
            </div>
          )}

          {/* Copy invite link */}
          {inviteToken && (
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyInviteLink}
                className="w-full"
              >
                {inviteCopied ? 'Copied!' : 'Copy invite link'}
              </Button>
            </div>
          )}

          {/* Pending invites list */}
          {pendingInvites.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-slate-500">Pending invites</p>
              {pendingInvites.map((inv) => (
                <div
                  key={inv.uuid}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"
                >
                  <div className="min-w-0 text-sm text-slate-700">
                    <span className="font-medium">{inv.inviter_name}</span>
                    <span className="text-slate-400">
                      {' '}invited you —{' '}
                      <span className={`font-medium capitalize ${
                        inv.status === 'pending'
                          ? 'text-amber-600'
                          : inv.status === 'accepted'
                            ? 'text-green-600'
                            : 'text-rose-500'
                      }`}>{inv.status}</span>
                    </span>
                  </div>
                  {inv.status === 'pending' && inv.invitee_id === currentUserId && (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => handleAcceptInvite(inv.uuid)}>
                        Accept
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDeclineInvite(inv.uuid)}>
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={() => setShowInvite(false)} className="mt-3">
            Close
          </Button>
        </Card>
      )}

      {/* Couple mode toggle (F9) */}
      {showCoupleToggle && (
        <Card className="mb-4 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400">Couple mode</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Combine settlements with your partner in this group.
            </p>
          </div>
          <Switch toggled={coupleMode} onChange={handleToggleCoupleMode} />
        </Card>
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
              onValueChange={(value) => setSettleFrom(value ?? '')}
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
              onValueChange={(value) => setSettleTo(value ?? '')}
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

      {/* Expense list (F11) */}
      {expenses.length > 0 && (
        <div className="space-y-2 mt-4">
          <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">
            Expenses
          </h2>
          {expenses.map((exp) => {
            const isDisputed = disputedExpenseUuids.has(exp.uuid)
            return (
            <div
              key={exp.uuid}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"
            >
              <div className="min-w-0 text-sm text-slate-700">
                <span className="font-medium">{exp.description}</span>
                <span className="text-slate-400"> — {formatCurrency(exp.amount)}</span>
                <div className="flex flex-wrap gap-x-2 items-center">
                  <span className="text-xs text-slate-400">
                    paid by {exp.paid_by_name} · {exp.date}
                  </span>
                  {isDisputed && (
                    <span className="text-xs text-amber-500 font-medium">⚖️ Under dispute</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {!isDisputed && (
                  <button
                    type="button"
                    onClick={() => handleOpenDispute(exp)}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                    aria-label={`Dispute ${exp.description}`}
                  >
                    ⚖️
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeletingExpense(exp.uuid)}
                  className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2"
                  aria-label={`Delete ${exp.description}`}
                >
                  🗑
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Delete confirmation dialog (F11) */}
      <ConfirmDialog
        open={deletingExpense !== null}
        title="Delete Expense"
        message="Are you sure you want to delete this expense? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => {
          if (deletingExpense) {
            deleteExpense(groupId, deletingExpense)
            setDeletingExpense(null)
            setBalances(getGroupBalances(groupId).balances)
            setExpenses(getExpenses(groupId))
            setSuggestedTxns([])
          }
        }}
        onCancel={() => setDeletingExpense(null)}
      />

      {/* Disputes section (F12) */}
      {pendingDisputes.length > 0 && (
        <DisputePanel
          groupId={groupId}
          expenses={expenses}
          onDisputeResolved={handleDisputeResolved}
        />
      )}

      {/* Dispute form modal (F12) */}
      {showDisputeForm && disputeExp && (
        <div
          data-testid="dispute-form"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDisputeForm(false)
          }}
        >
          <div className="w-full sm:max-w-sm mx-0 sm:mx-4 rounded-t-xl sm:rounded-xl bg-white shadow-lg p-5 animate-slide-up max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-slate-900">Dispute Expense</h3>
            <p className="mt-1 text-sm text-slate-500">
              Propose a corrected total or split for this expense.
            </p>

            <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
              <span className="font-medium text-slate-600">Original:</span>{' '}
              {disputeExp.description} — {formatCurrency(disputeExp.amount)}
              <div className="text-slate-400">paid by {disputeExp.paid_by_name} · {disputeExp.date}</div>
            </div>

            {/* Proposed total */}
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500 block mb-1">
                Alternative total <span className="text-slate-300">(optional)</span>
              </label>
              <Input
                value={disputeTotal}
                onChange={(e) => setDisputeTotal(e.target.value)}
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Leave blank to keep current total"
              />
            </div>

            {/* Proposed splits per member */}
            <div className="mt-4">
              <p className="text-xs font-medium text-slate-500 mb-1">
                Alternative split per member <span className="text-slate-300">(optional)</span>
              </p>
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 mt-1.5">
                  <span className="text-sm text-slate-700 w-24 truncate shrink-0">{m.name}</span>
                  <Input
                    value={disputeSplits[m.id] ?? ''}
                    onChange={(e) =>
                      setDisputeSplits((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>

            {disputeError && (
              <p className="mt-3 text-xs text-rose-500">{disputeError}</p>
            )}

            <div className="mt-5 flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDisputeForm(false)
                  setDisputeError('')
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmitDispute}>
                Submit Dispute
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>

      {activeTab === 'activity' && (
        <ActivityLog groupId={groupId} />
      )}
    </div>
  )
}