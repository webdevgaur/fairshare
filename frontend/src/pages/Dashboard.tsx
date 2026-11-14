import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getGroups, createGroup, getAnalytics, type AnalyticsSummary, type CategorySpend, type MonthlySpend } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

interface Group {
  id: number
  name: string
  description: string | null
  total_balance: number
  member_count: number
}

function BalanceBadge({ balance }: { balance: number }) {
  if (balance === 0) return <span className="text-sm text-slate-400">settled up</span>
  if (balance > 0) return <span className="text-sm font-medium text-green-600">+${balance.toFixed(2)}</span>
  return <span className="text-sm font-medium text-rose-600">-${Math.abs(balance).toFixed(2)}</span>
}

function GroupCard({ group }: { group: Group }) {
  return (
    <Link
      to={`/groups/${group.id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 rounded-xl"
    >
      <Card className="p-4 hover:border-slate-300 hover:shadow-sm transition-all duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-900 text-white grid place-items-center text-sm font-semibold">
              {group.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">{group.name}</h3>
              <p className="text-xs text-slate-400">{group.member_count} {group.member_count === 1 ? 'member' : 'members'}</p>
            </div>
          </div>
          <BalanceBadge balance={group.total_balance} />
        </div>
      </Card>
    </Link>
  )
}

const CHART_COLORS = ['#0f766e', '#d97706', '#7c3aed', '#dc2626', '#0ea5e9', '#16a34a', '#e11d48', '#2563eb', '#9333ea', '#f59e0b', '#14b8a6', '#64748b']

/** Minimal hand-built SVG donut showing proportional category spend. */
function DonutChart({ data }: { data: CategorySpend[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0)
  if (total <= 0) return <p className="text-sm text-slate-400">No spending to chart yet.</p>

  const R = 40
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" role="img" aria-label="Spending by category">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {data.map((d, i) => {
          const dash = (d.amount / total) * C
          const el = (
            <circle
              key={d.category}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          )
          offset += dash
          return el
        })}
      </svg>
      <ul className="text-sm space-y-1 min-w-0">
        {data.map((d, i) => (
          <li key={d.category} className="flex items-center gap-2" data-testid={`category-${d.category}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="text-slate-700 truncate">{d.category}</span>
            <span className="text-slate-500" data-testid={`category-amount-${d.category}`}>${d.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Minimal hand-built SVG-free bar chart of monthly spend (last 12 months). */
function BarChart({ data }: { data: MonthlySpend[] }) {
  if (!data.length) return <p className="text-sm text-slate-400">No monthly data yet.</p>
  const max = Math.max(...data.map((d) => d.amount), 1)
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 128 }} role="img" aria-label="Monthly spending over the last 12 months">
        {data.map((d) => (
          <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.month}: $${d.amount.toFixed(2)}`}>
            <div
              className="w-full rounded-t bg-teal-500"
              data-testid={`bar-${d.month}`}
              style={{ height: `${Math.max(2, (d.amount / max) * 100)}%`, opacity: d.amount > 0 ? 1 : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map((d) => (
          <span key={d.month} className="flex-1 text-center text-[10px] text-slate-400" data-testid={`month-${d.month}`}>{d.month.slice(5)}</span>
        ))}
      </div>
    </div>
  )
}

/** The F3 Spending Insights & Analytics dashboard section. */
function SpendingInsights({ analytics }: { analytics: AnalyticsSummary }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-3">Spending Insights</h2>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="p-4" data-testid="analytics-this-month">
          <p className="text-xs text-slate-500 font-semibold tracking-wide">This month</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">${analytics.totalThisMonth.toFixed(2)}</p>
        </Card>
        <Card className="p-4" data-testid="analytics-last-month">
          <p className="text-xs text-slate-500 font-semibold tracking-wide">Last month</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">${analytics.totalLastMonth.toFixed(2)}</p>
        </Card>
        <Card className="p-4" data-testid="analytics-all-time">
          <p className="text-xs text-slate-500 font-semibold tracking-wide">All time</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">${analytics.totalAllTime.toFixed(2)}</p>
        </Card>
      </div>

      {analytics.expenseCount === 0 ? (
        <Card className="text-center py-8">
          <div className="text-3xl mb-2">📊</div>
          <p className="text-slate-500 font-medium">No spending yet</p>
          <p className="text-sm text-slate-400 mt-1">Add expenses to see insights</p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">By category</h3>
            <DonutChart data={analytics.byCategory} />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Monthly spending</h3>
            <BarChart data={analytics.monthlySpend} />
          </Card>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [groups, setGroups] = useState<Group[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [members, setMembers] = useState('')

  useEffect(() => {
    setGroups(getGroups())
    setAnalytics(getAnalytics())
    setLoading(false)
  }, [])

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const memberNames = members
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
    const group = createGroup(name, desc, memberNames)
    setGroups((prev) => [group, ...prev])
    setShowForm(false)
    setName('')
    setDesc('')
    setMembers('')
  }

  const totalOwed = groups.reduce((s, g) => s + Math.max(0, g.total_balance), 0)
  const totalDebt = groups.reduce((s, g) => s + Math.max(0, -g.total_balance), 0)

  return (
    <div className="animate-fade-in">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="bg-green-50 border-green-200 p-4">
          <p className="text-xs text-green-700 font-semibold tracking-wide">You're owed</p>
          <p className="text-xl sm:text-2xl font-bold text-green-700 mt-1">${totalOwed.toFixed(2)}</p>
        </Card>
        <Card className="bg-rose-50 border-rose-200 p-4">
          <p className="text-xs text-rose-700 font-semibold tracking-wide">You owe</p>
          <p className="text-xl sm:text-2xl font-bold text-rose-700 mt-1">${totalDebt.toFixed(2)}</p>
        </Card>
      </div>

      {/* Spending Insights (F3) */}
      {analytics && <SpendingInsights analytics={analytics} />}

      {/* Groups header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900">Groups</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="bg-white"
        >
          + New Group
        </Button>
      </div>

      {/* Create group form */}
      {showForm && (
        <Card className="mb-3">
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              autoFocus
            />
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
            />
            <Input
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              placeholder="Other members (comma-separated names)"
            />
            <div className="flex gap-2">
              <Button type="submit">
                Create
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Group list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4 animate-shimmer">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 rounded w-32" />
                  <div className="h-3 bg-slate-100 rounded w-20 mt-1" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-3xl mb-3">👥</div>
          <p className="text-slate-500 font-medium">No groups yet</p>
          <p className="text-sm text-slate-400 mt-1">Create a group to start splitting expenses</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => <GroupCard key={g.id} group={g} />)}
        </div>
      )}
    </div>
  )
}