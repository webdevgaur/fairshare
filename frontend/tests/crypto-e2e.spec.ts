import { test, expect } from '@playwright/test'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  sealOp,
  openSealedEnvelope,
  x25519PublicKeyHex,
  clearCachedKeys,
} from '../src/lib/crypto'

// @noble/ed25519 uses sync hashing when sha512 is wired in.
ed.hashes.sha512 = sha512

/* ─── localStorage shim (crypto.ts reads/writes it in Node) ──────────────── */

const mem = new Map<string, string>()
;(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return b
}
function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/** Swap the local identity seed and clear the module's key caches. */
function setIdentity(seedHex: string): void {
  const pub = ed.getPublicKey(hexToBytes(seedHex))
  mem.set('fairshare_ed25519_priv', seedHex)
  mem.set('fairshare_ed25519_pub', bytesToHex(pub))
  clearCachedKeys()
}

/** Build a 32-byte (64-hex) seed starting at `start`. */
function seedFrom(start: number): string {
  let hex = ''
  for (let i = 0; i < 32; i++) hex += (start + i).toString(16).padStart(2, '0')
  return hex
}

const seedA = seedFrom(0x10)
const seedB = seedFrom(0x40)
const seedC = seedFrom(0x80)

const op = {
  op_id: 'op-1',
  type: 'create_expense',
  group_id: 1,
  lamport_counter: 1,
  peer_id: 'peerA',
  data: { description: 'Lunch at Kimbap', amount: 12.5, paid_by: 'peerA' },
  created_at: 1700000000000,
}

test.describe('E2E sealed-envelope crypto (X25519 + AES-256-GCM)', () => {
  test('seal → open round-trips a CRDT op exactly', async () => {
    setIdentity(seedA) // sender
    const senderPubHex = x25519PublicKeyHex()
    setIdentity(seedB) // recipient (to read recipient X pub)
    const recipientXPub = hexToBytes(x25519PublicKeyHex())

    setIdentity(seedA) // back to sender to seal
    const bytes = await sealOp(op, [{ x25519PublicKey: recipientXPub }])
    expect(bytes).toBeInstanceOf(Uint8Array)

    setIdentity(seedB) // open as the intended recipient
    const opened = await openSealedEnvelope(bytes)
    expect(opened).not.toBeNull()
    expect(opened!.op).toEqual(op)
    // Sender's identity rides in the envelope and is recovered intact.
    expect(bytesToHex(opened!.senderPublicKey)).toBe(bytesToHex(ed.getPublicKey(hexToBytes(seedA))))
    expect(opened!.senderX25519PublicKey.length).toBe(32)
    // Sender's X25519 public key is distinct from the recipient's.
    expect(bytesToHex(opened!.senderX25519PublicKey)).not.toBe(senderPubHex)
  })

  test('a non-listed recipient cannot unseal (member-level access control)', async () => {
    setIdentity(seedA)
    const recipientXPub = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedA)
    const bytes = await sealOp(op, [{ x25519PublicKey: recipientXPub }])

    // A third party (seedC) holds a different key — not listed as a recipient.
    setIdentity(seedC)
    const opened = await openSealedEnvelope(bytes)
    expect(opened).toBeNull()
  })

  test('tampered ciphertext is rejected (AEAD authentication)', async () => {
    setIdentity(seedA)
    const recipientXPub = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedA)
    const bytes = await sealOp(op, [{ x25519PublicKey: recipientXPub }])

    // Flip one byte in the ciphertext region (just before the 64-byte signature).
    const tampered = bytes.slice()
    const i = tampered.length - 66
    tampered[i] ^= 0x01

    setIdentity(seedA)
    const opened = await openSealedEnvelope(tampered)
    expect(opened).toBeNull()
  })

  test('tampering the sender public key breaks the signature', async () => {
    setIdentity(seedA)
    const recipientXPub = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedA)
    const bytes = await sealOp(op, [{ x25519PublicKey: recipientXPub }])

    // Flip a byte in the sender Ed25519 pubkey field (offset 4..35).
    const tampered = bytes.slice()
    tampered[5] ^= 0x01

    setIdentity(seedA) // still the intended recipient's identity to read the key
    const opened = await openSealedEnvelope(tampered)
    expect(opened).toBeNull()
  })

  test('the relay/wire carries no plaintext op content', async () => {
    setIdentity(seedA)
    const recipientXPub = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedA)
    const bytes = await sealOp(op, [{ x25519PublicKey: recipientXPub }])

    // Search the raw envelope bytes for any readable plaintext markers.
    const asText = bytesToHex(bytes)
    expect(asText).not.toContain('Kimbap')
    expect(asText).not.toContain('12.5')
    expect(asText).not.toContain('create_expense')
    // The magic + version are still present (format, not content).
    expect(bytes[0]).toBe(0x46)
    expect(bytes[1]).toBe(0x45)
  })

  test('per-recipient sealing: two recipients each decrypt independently', async () => {
    setIdentity(seedA) // sender
    setIdentity(seedB)
    const recvB = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedC)
    const recvC = hexToBytes(x25519PublicKeyHex())
    setIdentity(seedA) // sender to seal

    const bytes = await sealOp(op, [{ x25519PublicKey: recvB }, { x25519PublicKey: recvC }])

    // Recipient B opens.
    setIdentity(seedB)
    const openedB = await openSealedEnvelope(bytes)
    expect(openedB).not.toBeNull()
    expect(openedB!.op).toEqual(op)

    // Recipient C opens.
    setIdentity(seedC)
    const openedC = await openSealedEnvelope(bytes)
    expect(openedC).not.toBeNull()
    expect(openedC!.op).toEqual(op)
  })
})
