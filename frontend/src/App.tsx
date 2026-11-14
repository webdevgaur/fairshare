import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import GroupPage from './pages/GroupPage'
import Profile from './pages/Profile'
import { getLocalUser, setLocalUser } from './lib/identity'
import { syncClient, type SyncStatus } from './lib/sync'

function SyncDot({ status }: { status: SyncStatus }) {
  const colors: Record<SyncStatus, string> = {
    synced: 'bg-green-500',
    queued: 'bg-amber-400',
    offline: 'bg-slate-300',
    connecting: 'bg-slate-300',
  }
  const titles: Record<SyncStatus, string> = {
    synced: 'Synced',
    queued: 'Changes queued',
    offline: 'Offline',
    connecting: 'Connecting',
  }
  const isPulsing = status === 'connecting' || status === 'queued'
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]} shrink-0 ${isPulsing ? 'sync-dot-pulse' : ''}`}
      title={titles[status]}
    />
  )
}

function NamePrompt({ onSet }: { onSet: () => void }) {
  const [name, setName] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLocalUser(name.trim())
    onSet()
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 text-white text-2xl mb-4">
            ÷
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">FairShare</h1>
          <p className="text-slate-500 mt-1 text-sm">Split expenses, not friendships</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">What's your name?</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:border-slate-400"
            autoFocus
          />
          <button
            type="submit"
            className="w-full bg-slate-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 active-scale-press"
          >
            Get started
          </button>
        </form>
      </div>
    </div>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncClient.status)
  const user = getLocalUser()

  useEffect(() => {
    const unsub = syncClient.onStatusChange(setSyncStatus)
    return unsub
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-3 sm:px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-lg font-bold text-slate-900 tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 rounded-lg">
          FairShare
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <SyncDot status={syncStatus} />
            <span className="hidden sm:inline capitalize">{syncStatus}</span>
          </div>
          {user && (
            <Link to="/profile" className="flex items-center gap-2 p-1 -m-1 hover:opacity-80 transition-opacity rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
              <span className="w-7 h-7 rounded-full bg-slate-900 text-white grid place-items-center text-xs font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm text-slate-600 hidden sm:inline">{user.name}</span>
            </Link>
          )}
        </div>
      </nav>
      <main className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6">{children}</main>
    </div>
  )
}

function App() {
  const [userReady, setUserReady] = useState(!!getLocalUser())

  const handleSet = useCallback(() => setUserReady(true), [])

  if (!userReady) {
    return <NamePrompt onSet={handleSet} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/groups/:id" element={<Layout><GroupPage /></Layout>} />
        <Route path="/profile" element={<Layout><Profile /></Layout>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App