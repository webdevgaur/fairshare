import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getGroups, createGroup } from '../lib/api'
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

export default function Dashboard() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [members, setMembers] = useState('')

  useEffect(() => {
    setGroups(getGroups())
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