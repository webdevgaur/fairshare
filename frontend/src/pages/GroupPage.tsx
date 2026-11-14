import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { getGroup, getGroupBalances, getGroupMembers, getExpenses, createExpense, getSettlements, createSettlement } from '../lib/api'

interface Balance {
  user_id: number
  user_name: string
  balance: number
}

interface ExpenseSplit {
  user_id: number
  user_name: string
  amount: number
}

interface Expense {
  id: number
  group_id: number
  paid_by: number
  paid_by_name: string
  amount: number
  description: string
  date: string
  splits: ExpenseSplit[]
}

interface Settlement {
  id: number
  from_user: number
  from_user_name: string
  to_user: number
  to_user_name: string
  amount: number
  date: string
}

interface Member {
  id: number
  name: string
  email: string
}

function formatCurrency(n: number) {
  return '$' + n.toFixed(2)
}

export default function GroupPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useUser()
  const groupId = Number(id)

  const [group, setGroup] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)

  // Expense form
  const [showExpense, setShowExpense] = useState(false)
  const [expDesc, setExpDesc] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expSplits, setExpSplits] = useState<'equal' | 'custom'>('equal')

  // Settlement form
  const [showSettle, setShowSettle] = useState(false)
  const [settleTo, setSettleTo] = useState('')
  const [settleAmount, setSettleAmount] = useState('')

  useEffect(() => {
    Promise.all([
      getGroup(groupId),
      getGroupMembers(groupId),
      getGroupBalances(groupId),
      getExpenses(groupId),
      getSettlements(groupId),
    ])
      .then(([g, m, b, e, s]) => {
        setGroup(g)
        setMembers(m)
        setBalances(b.balances)
        setExpenses(e)
        setSettlements(s)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [groupId])

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(expAmount)
    if (!expDesc.trim() || !amount || amount <= 0) return

    const splits = expSplits === 'equal'
      ? members.map(m => ({ user_id: m.id }))
      : members.map(m => ({ user_id: m.id, amount: amount / members.length }))

    await createExpense({
      group_id: groupId,
      amount,
      description: expDesc,
      splits,
    })

    const [updatedExpenses, updatedBalances] = await Promise.all([
      getExpenses(groupId),
      getGroupBalances(groupId),
    ])
    setExpenses(updatedExpenses)
    setBalances(updatedBalances.balances)
    setShowExpense(false)
    setExpDesc('')
    setExpAmount('')
  }

  async function handleSettle(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(settleAmount)
    if (!settleTo || !amount || amount <= 0) return

    await createSettlement({
      group_id: groupId,
      from_user: Number(settleTo),
      to_user: balances.find(b => b.balance > 0)?.user_id || 0,
      amount,
    })

    const [updatedSettlements, updatedBalances] = await Promise.all([
      getSettlements(groupId),
      getGroupBalances(groupId),
    ])
    setSettlements(updatedSettlements)
    setBalances(updatedBalances.balances)
    setShowSettle(false)
    setSettleTo('')
    setSettleAmount('')
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-48" />
        <div className="h-4 bg-slate-100 rounded w-32" />
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
      </div>
    )
  }

  if (!group) return <p className="text-slate-400">Group not found</p>

  const currentUserId = members.find(m => m.email === user?.primaryEmailAddress?.emailAddress)?.id

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-slate-400 hover:text-slate-600">&larr;</Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{group.name}</h1>
          {group.description && <p className="text-sm text-slate-400">{group.description}</p>}
        </div>
      </div>

      {/* Balances */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Balances</h2>
        <div className="space-y-2">
          {balances.map(b => (
            <div key={b.user_id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{b.user_name}</span>
              <span className={b.balance > 0 ? 'text-green-600 font-medium' : b.balance < 0 ? 'text-rose-600 font-medium' : 'text-slate-400'}>
                {b.balance === 0 ? 'settled' : b.balance > 0 ? `+${formatCurrency(b.balance)}` : formatCurrency(b.balance)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowExpense(!showExpense)}
          className="flex-1 bg-slate-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          + Add Expense
        </button>
        <button
          onClick={() => setShowSettle(!showSettle)}
          className="flex-1 bg-white border border-slate-200 text-slate-700 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Settle Up
        </button>
      </div>

      {/* Add expense form */}
      {showExpense && (
        <form onSubmit={handleAddExpense} className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
          <input
            value={expDesc}
            onChange={e => setExpDesc(e.target.value)}
            placeholder="What for?"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400"
            autoFocus
          />
          <input
            value={expAmount}
            onChange={e => setExpAmount(e.target.value)}
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Amount"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExpSplits('equal')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${expSplits === 'equal' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Equal
            </button>
            <button
              type="button"
              onClick={() => setExpSplits('custom')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${expSplits === 'custom' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Custom
            </button>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800">
              Add
            </button>
            <button type="button" onClick={() => setShowExpense(false)} className="text-sm text-slate-500 px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Settle form */}
      {showSettle && (
        <form onSubmit={handleSettle} className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
          <select
            value={settleTo}
            onChange={e => setSettleTo(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400 bg-white"
          >
            <option value="">Who's paying?</option>
            {balances.filter(b => b.balance < 0).map(b => (
              <option key={b.user_id} value={b.user_id}>{b.user_name} owes {formatCurrency(Math.abs(b.balance))}</option>
            ))}
          </select>
          <input
            value={settleAmount}
            onChange={e => setSettleAmount(e.target.value)}
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Amount"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400"
          />
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800">
              Record Payment
            </button>
            <button type="button" onClick={() => setShowSettle(false)} className="text-sm text-slate-500 px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Expense feed */}
      <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">Expenses</h2>
      {expenses.length === 0 ? (
        <p className="text-sm text-slate-300 text-center py-6">No expenses yet</p>
      ) : (
        <div className="space-y-2 mb-6">
          {expenses.map(exp => (
            <div key={exp.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{exp.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{exp.paid_by_name} paid &middot; {exp.date}</p>
                </div>
                <p className="font-semibold text-slate-900">{formatCurrency(exp.amount)}</p>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100">
                {exp.splits.map(s => (
                  <div key={s.user_id} className="flex items-center justify-between text-xs text-slate-500 py-0.5">
                    <span>{s.user_name}</span>
                    <span>{formatCurrency(s.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Settlements */}
      {settlements.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">Settlements</h2>
          <div className="space-y-2">
            {settlements.map(s => (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{s.from_user_name}</span>
                  <span className="text-slate-400 mx-1">paid</span>
                  <span className="font-medium">{s.to_user_name}</span>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{formatCurrency(s.amount)}</p>
                  <p className="text-xs text-slate-400">{s.date}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}