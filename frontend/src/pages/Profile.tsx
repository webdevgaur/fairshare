import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLocalUser, setLocalUser, clearLocalUser, getPublicKeyHex } from '../lib/identity'
import { fingerprint } from '../lib/crypto'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

export default function Profile() {
  const navigate = useNavigate()
  const user = getLocalUser()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)

  const fp = fingerprint()
  const pubKey = getPublicKeyHex()

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLocalUser(name.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleReset() {
    if (!window.confirm('Reset identity? This will generate a new keypair and clear your name. Your groups and expenses will remain.')) return
    clearLocalUser()
    navigate('/')
  }

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