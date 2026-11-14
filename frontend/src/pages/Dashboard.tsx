import { useState, useEffect } from 'react'
import { useUser } from '@clerk/react'
import { Link } from 'react-router-dom'
import { getGroups, createGroup } from '../lib/api'

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
      className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors"
    >
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
    </Link>
  )
}

export default function Dashboard() {
  const { user } = useUser()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const group = await createGroup(name, desc, [])
    setGroups(prev => [group, ...prev])
    setShowForm(false)
    setName('')
    setDesc('')
  }

  const totalOwed = groups.reduce((s, g) => s + Math.max(0, g.total_balance), 0)
  const totalDebt = groups.reduce((s, g) => s + Math.max(0, -g.total_balance), 0)

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">You're owed</p>
          <p className="text-2xl font-bold text-green-600 mt-1">${totalOwed.toFixed(2)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">You owe</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">${totalDebt.toFixed(2)}</p>
        </div>
      </div>

      {/* Groups header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900">Groups</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
        >
          + New Group
        </button>
      </div>

      {/* Create group form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-4 mb-3 space-y-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Group name"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400"
            autoFocus
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-slate-500 px-4 py-2 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Group list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 rounded w-32" />
                  <div className="h-3 bg-slate-100 rounded w-20 mt-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400">No groups yet</p>
          <p className="text-sm text-slate-300 mt-1">Create one to start splitting expenses</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(g => <GroupCard key={g.id} group={g} />)}
        </div>
      )}
    </div>
  )
}