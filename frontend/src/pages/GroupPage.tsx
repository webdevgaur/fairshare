import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import React from 'react'
import {
  getGroup,
  getGroupBalances,
  getGroupMembers,
  getExpenses,
  createExpense,
  getSettlements,
  createSettlement,
  getCurrentUserId,
} from '../lib/api'
import type { BalanceEntry, Expense, Settlement } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [showBalances, setShowBalances] = useState(false)

  // Expense form
  const [showExpense, setShowExpense] = useState(false)
  const [expDesc, setExpDesc] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expSplits, setExpSplits] = useState<'equal' | 'custom'>('equal')

  // Settlement form
  const [showSettle, setShowSettle] = useState(false)
  const [settleFrom, setSettleFrom] = useState('')
  const [settleAmount, setSettleAmount] = useState('')

  const currentUserId = getCurrentUserId()

  function loadData() {
    const g = getGroup(groupId)
    const m = getGroupMembers(groupId)
    const b = getGroupBalances(groupId)
    const e = getExpenses(groupId)
    const s = getSettlements(groupId)

    setGroup(g)
    setMembers(m)
    setBalances(b.balances)
    setExpenses(e)
    setSettlements(s)
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

    const splits =
      expSplits === 'equal'
        ? members.map((m) => ({ user_id: m.id }))
        : members.map((m) => ({ user_id: m.id, amount: amount / members.length }))

    createExpense({
      group_id: groupId,
      amount,
      description: expDesc,
      splits,
    })

    // Reload data
    setExpenses(getExpenses(groupId))
    setBalances(getGroupBalances(groupId).balances)
    setShowExpense(false)
    setExpDesc('')
    setExpAmount('')
  }

  function handleSettle(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(settleAmount)
    if (!settleFrom || !amount || amount <= 0) return

    createSettlement({
      group_id: groupId,
      from_user: settleFrom,
      to_user: balances.find((b) => b.balance > 0)?.user_id || '',
      amount,
    })

    // Reload data
    setSettlements(getSettlements(groupId))
    setBalances(getGroupBalances(groupId).balances)
    setShowSettle(false)
    setSettleFrom('')
    setSettleAmount('')
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
                  {b.user_name}
                  {b.user_id === currentUserId && (
                    <Badge variant="secondary" className="ml-1.5 bg-blue-50 text-blue-700 hover:bg-blue-50 border-none">
                      you
                    </Badge>
                  )}
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
                      : formatCurrency(b.balance)}
                </span>
              </div>
            ))}
          </div>
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
      </div>

      {/* Add expense form */}
      <div className={`transition-all duration-200 ease-in-out overflow-hidden ${showExpense ? 'max-h-96 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
        <Card>
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
      </div>

      {/* Settle form */}
      <div className={`transition-all duration-200 ease-in-out overflow-hidden ${showSettle ? 'max-h-96 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
        <Card>
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
            <Input
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount"
            />
            <div className="flex gap-2">
              <Button type="submit">
                Record Payment
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowSettle(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Expense feed */}
      <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        <span className="inline-block w-0.5 h-3.5 rounded-full bg-slate-300" />
        Expenses
      </h2>
      {expenses.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-3xl mb-3">🧾</div>
          <p className="text-slate-500 font-medium">No expenses yet</p>
          <p className="text-sm text-slate-400 mt-1">Tap "Add Expense" to split your first bill</p>
        </Card>
      ) : (
        <div className="space-y-2 mb-6">
          {expenses.map((exp, idx) => {
            const showDate = idx === 0 || exp.date !== expenses[idx - 1].date
            const isUserInvolved = currentUserId && (exp.paid_by === currentUserId || exp.splits.some(s => s.user_id === currentUserId))
            return (
              <React.Fragment key={exp.id}>
                {showDate && (
                  <div className="flex items-center gap-2 pt-4 first:pt-0">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {exp.date}
                    </span>
                    <span className="flex-1 h-px bg-slate-100" />
                  </div>
                )}
                <Card className={`p-4 transition-all duration-150 ${
                  isUserInvolved
                    ? 'border-l-4 border-l-slate-400'
                    : ''
                } hover:border-slate-300 hover:shadow-sm`}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate">{exp.description}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        <span className="text-slate-500">{exp.paid_by_name}</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span>{exp.date}</span>
                        <span className="text-slate-300 mx-1">·</span>
                        <span className="text-slate-500">{exp.splits.length} ways</span>
                      </p>
                    </div>
                    <p className="font-semibold text-slate-900 shrink-0 ml-2">{formatCurrency(exp.amount)}</p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    {exp.splits.map((s) => (
                      <div key={s.user_id} className="flex items-center justify-between text-xs py-0.5">
                        <span className={s.user_id === currentUserId ? 'font-medium text-slate-900' : 'text-slate-500'}>
                          {s.user_name}
                          {s.user_id === currentUserId && (
                            <Badge variant="secondary" className="ml-1.5 bg-blue-50 text-blue-700 hover:bg-blue-50 border-none">
                              you
                            </Badge>
                          )}
                        </span>
                        <span className="text-slate-500">{formatCurrency(s.amount)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Settlements */}
      {settlements.length > 0 && (
        <>
          <h2 className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span className="inline-block w-0.5 h-3.5 rounded-full bg-amber-300" />
            Settlements
          </h2>
          <div className="space-y-2">
            {settlements.map((s) => (
              <Card key={s.id} className="p-4 flex items-center justify-between border-l-4 border-l-amber-400 hover:border-slate-300 hover:shadow-sm transition-all duration-150">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-lg">↩️</span>
                  <div>
                    <span className="font-medium text-slate-900">{s.from_user_name}</span>
                    <span className="text-slate-400 mx-1">paid</span>
                    <span className="font-medium text-slate-900">{s.to_user_name}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{formatCurrency(s.amount)}</p>
                  <p className="text-xs text-slate-400">{s.date}</p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}