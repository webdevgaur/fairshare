import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLocalUser, setLocalUser, clearLocalUser, getPublicKeyHex } from '../lib/identity'
import { fingerprint } from '../lib/crypto'
import { getUserPaymentHandles, updatePaymentHandles, exportData, importJSON, importSplitwiseCSV, isSplitwiseImport, getCoupleForUser, registerCouple, unregisterCouple, getUserName, getUsers } from '../lib/api'
import type { CoupleRecord } from '../lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

/** Trigger a browser download of a string as a file. */
function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function Profile() {
  const navigate = useNavigate()
  const user = getLocalUser()
  const userId = user?.id ?? ''
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)

  // Payment handles — load once from the store on first render
  const [venmo, setVenmo] = useState(() => getUserPaymentHandles(userId)?.venmo_username ?? '')
  const [paypal, setPaypal] = useState(() => getUserPaymentHandles(userId)?.paypal_handle ?? '')
  const [cashapp, setCashapp] = useState(() => getUserPaymentHandles(userId)?.cashapp_cashtag ?? '')
  const [handlesSaved, setHandlesSaved] = useState(false)

  // Couple (F9)
  const [couple, setCouple] = useState<CoupleRecord | null>(() => getCoupleForUser(userId) ?? null)
  const [partnerInput, setPartnerInput] = useState('')
  const [coupleMsg, setCoupleMsg] = useState('')
  const [coupleErr, setCoupleErr] = useState('')

  // Export / import (F5)
  const [impStatus, setImpStatus] = useState('')
  const [replaceMode, setReplaceMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExportJSON() {
    const { json } = exportData()
    downloadText('fairshare-export.json', json, 'application/json')
    setImpStatus('Exported JSON backup.')
  }

  function handleExportCSV() {
    const { csv } = exportData()
    for (const f of csv) {
      downloadText(f.filename, f.content, 'text/csv;charset=utf-8')
    }
    setImpStatus('Exported expenses.csv, settlements.csv and groups.csv.')
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (replaceMode && !window.confirm('Replace all current data? This cannot be undone.')) return
    const text = await file.text()
    try {
      const result = isSplitwiseImport(text)
        ? importSplitwiseCSV(text)
        : importJSON(text, replaceMode ? 'replace' : 'merge')
      setImpStatus(result.message)
    } catch (err) {
      setImpStatus((err as Error).message)
    }
  }

  const fp = fingerprint()
  const pubKey = getPublicKeyHex()

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLocalUser(name.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleSaveHandles(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    updatePaymentHandles(userId, {
      venmo_username: venmo.trim() || null,
      paypal_handle: paypal.trim() || null,
      cashapp_cashtag: cashapp.trim() || null,
    })
    setHandlesSaved(true)
    setTimeout(() => setHandlesSaved(false), 2000)
  }

  function handleRegisterCouple(e: React.FormEvent) {
    e.preventDefault()
    setCoupleErr('')
    setCoupleMsg('')
    if (!userId || !partnerInput.trim()) return
    const input = partnerInput.trim()
    // Resolve the partner by name (case-insensitive) first, then by exact id.
    const users = getUsers()
    const byName = users.find((u) => u.name.toLowerCase() === input.toLowerCase() && u.id !== userId)
    const byId = users.find((u) => u.id === input && u.id !== userId)
    const partnerId = byName ? byName.id : byId ? byId.id : input
    if (partnerId === userId) {
      setCoupleErr('You cannot register yourself as your partner.')
      return
    }
    try {
      const c = registerCouple(userId, partnerId)
      setCouple(c)
      setPartnerInput('')
      setCoupleMsg('Registered as a couple.')
    } catch (err) {
      setCoupleErr((err as Error).message)
    }
  }

  function handleUnregister() {
    if (!couple) return
    if (!window.confirm('Unregister this couple? You will no longer be netted with them in group settlements.')) return
    unregisterCouple(couple.id)
    setCouple(null)
    setCoupleMsg('Couple unregistered.')
  }

  function handleReset() {
    if (!window.confirm('Reset identity? This will generate a new keypair and clear your name. Your groups and expenses will remain.')) return
    clearLocalUser()
    navigate('/')
  }

  const partnerId = couple ? (couple.user_a === userId ? couple.user_b : couple.user_a) : ''
  const partnerName = partnerId ? getUserName(partnerId) : ''

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold text-slate-900">Profile</h1>

      {/* Device fingerprint */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">Device Fingerprint</h2>
        <p className="font-mono text-sm text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          {fp}
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Your unique device identifier. Derived from your Ed25519 keypair.
        </p>
      </Card>

      {/* Public key */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">Public Key</h2>
        <p className="font-mono text-xs text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 break-all">
          {pubKey}
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Share this with peers to verify your identity in sync messages.
        </p>
      </Card>

      {/* Name editing */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Display Name</h2>
        <form onSubmit={handleSaveName} className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit">
              {saved ? 'Saved!' : 'Save'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Payment handles */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Payment handles</h2>
        <p className="text-sm text-slate-500 mb-3">
          Add your payment handles so group members can send you a settlement via Venmo, PayPal, or Cash App.
        </p>
        <form onSubmit={handleSaveHandles} className="space-y-3">
          <Input
            value={venmo}
            onChange={(e) => setVenmo(e.target.value)}
            placeholder="Venmo username"
          />
          <Input
            value={paypal}
            onChange={(e) => setPaypal(e.target.value)}
            placeholder="PayPal handle / email"
          />
          <Input
            value={cashapp}
            onChange={(e) => setCashapp(e.target.value)}
            placeholder="Cash App cashtag (e.g. $username)"
          />
          <div className="flex gap-2">
            <Button type="submit">
              {handlesSaved ? 'Saved!' : 'Save Handles'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Couple (F9) */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Couple</h2>
        {couple ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Registered with <span className="font-medium text-slate-900">{partnerName || partnerId}</span>.
            </p>
            <p className="text-xs text-slate-400">
              In any group where couple mode is on, you won't be suggested to settle up with your partner directly — only your combined net is settled.
            </p>
            <Button variant="destructive" size="sm" onClick={handleUnregister}>
              Unregister
            </Button>
          </div>
        ) : (
          <form onSubmit={handleRegisterCouple} className="space-y-3">
            <p className="text-sm text-slate-500">
              Register with a partner to combine your net balances in groups that have couple mode on.
            </p>
            <Input
              value={partnerInput}
              onChange={(e) => setPartnerInput(e.target.value)}
              placeholder="Partner's name or user ID"
            />
            <div className="flex gap-2">
              <Button type="submit">
                Register as Couple
              </Button>
            </div>
          </form>
        )}
        {coupleMsg && <p className="text-sm text-green-600 mt-3">{coupleMsg}</p>}
        {coupleErr && <p className="text-sm text-rose-600 mt-3">{coupleErr}</p>}
      </Card>

      {/* Export / Import data */}
      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-3">Export / Import Data</h2>
        <p className="text-sm text-slate-500 mb-3">
          Back up your data as JSON (lossless) or flattened CSV (for spreadsheets), or import a FairShare backup or a Splitwise CSV export.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExportJSON}>Export JSON</Button>
          <Button onClick={handleExportCSV}>Export CSV</Button>
        </div>
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={replaceMode}
              onChange={(e) => setReplaceMode(e.target.checked)}
              className="mt-0.5"
            />
            <span>Replace all data on import (destructive — wipes current data)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={handleImportFile}
              className="text-sm text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:py-1.5 file:px-3 file:text-sm file:font-medium file:text-white"
            />
          </div>
        </div>
        {impStatus && <p className="text-sm text-slate-600 mt-3">{impStatus}</p>}
      </Card>

      {/* Reset identity */}
      <Card className="p-4 border-red-200">
        <h2 className="text-xs uppercase tracking-wider font-medium text-red-500 mb-2">Danger Zone</h2>
        <p className="text-sm text-slate-600 mb-3">
          Reset your identity to generate a new keypair. Your name will be cleared and you'll need to re-enter it.
        </p>
        <Button
          variant="destructive"
          onClick={handleReset}
        >
          Reset Identity
        </Button>
      </Card>
    </div>
  )
}