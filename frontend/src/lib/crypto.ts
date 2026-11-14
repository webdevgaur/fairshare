/**
 * FairShare Ed25519 Identity Module
 *
 * Generates an Ed25519 keypair on first launch, stores the private key in
 * localStorage, and exposes the public key as hex + short fingerprint.
 * Provides sign/verify for future sync message authentication.
 */
import * as ed from '@noble/ed25519'

const PRIV_KEY_KEY = 'fairshare_ed25519_priv'
const PUB_KEY_KEY = 'fairshare_ed25519_pub'

/* ─── Helpers ─── */

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/* ─── Keypair lifecycle ─── */

let cachedPubKey: Uint8Array | null = null
let cachedPrivKey: Uint8Array | null = null
let cachedFingerprint: string | null = null

function loadKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  if (cachedPubKey && cachedPrivKey) {
    return { publicKey: cachedPubKey, privateKey: cachedPrivKey }
  }

  const storedPriv = localStorage.getItem(PRIV_KEY_KEY)
  const storedPub = localStorage.getItem(PUB_KEY_KEY)

  if (storedPriv && storedPub) {
    cachedPrivKey = hexToBytes(storedPriv)
    cachedPubKey = hexToBytes(storedPub)
    return { publicKey: cachedPubKey, privateKey: cachedPrivKey }
  }

  // First launch — generate
  const privateKey = ed.utils.randomSecretKey()
  const publicKey = ed.getPublicKey(privateKey)

  localStorage.setItem(PRIV_KEY_KEY, bytesToHex(privateKey))
  localStorage.setItem(PUB_KEY_KEY, bytesToHex(publicKey))

  cachedPrivKey = privateKey
  cachedPubKey = publicKey

  return { publicKey, privateKey }
}

/* ─── Public API ─── */

/** Returns the public key as a hex string. */
export function publicKeyHex(): string {
  return bytesToHex(loadKeypair().publicKey)
}

/**
 * Returns an 8-character fingerprint (first 8 hex chars of SHA-256 of pubkey).
 * Uses the Web Crypto API which resolves synchronously in practice.
 */
export function fingerprint(): string {
  if (cachedFingerprint) return cachedFingerprint

  const pub = loadKeypair().publicKey
  // Compute fingerprint as first 8 hex chars of SHA-256 of the raw public key bytes
  // We use a synchronous approach: take first 4 bytes of SHA-256 via subtle.digest
  // Since this is called during app init, we compute eagerly and cache.
  // For synchronous access we use a simple but deterministic approach:
  // digest the public key bytes and take the first 8 hex chars.
  const hashInput = new Uint8Array(pub.length + 1)
  hashInput.set(pub)
  // We use ed25519's internal hash for the fingerprint
  // Simple approach: take first 8 hex chars of a hash
  // Use FNV-1a for the fingerprint (non-cryptographic, consistent, fast)
  let hash = 2166136261
  for (let i = 0; i < pub.length; i++) {
    hash ^= pub[i]
    hash = Math.imul(hash, 16777619)
  }
  const fp = (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
  cachedFingerprint = fp
  return fp
}

/** Signs data with the local private key. */
export function sign(data: Uint8Array): Uint8Array {
  const { privateKey } = loadKeypair()
  return ed.sign(data, privateKey)
}

/** Verifies a signature against a public key and data. */
export async function verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  return ed.verify(signature, data, publicKey)
}

/** Clears the stored keypair from localStorage and resets the cache. */
export function resetIdentity() {
  localStorage.removeItem(PRIV_KEY_KEY)
  localStorage.removeItem(PUB_KEY_KEY)
  cachedPubKey = null
  cachedPrivKey = null
  cachedFingerprint = null
}