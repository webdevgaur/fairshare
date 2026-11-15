/**
 * FairShare Identity Module
 *
 * Manages the local user's identity backed by an Ed25519 keypair.
 * The user id is the public key fingerprint (8-char hex string).
 * The name is editable and persisted alongside the keypair.
 */
import { fingerprint, publicKeyHex, x25519PublicKeyHex, resetIdentity as resetCryptoIdentity } from './crypto'

const STORAGE_KEY = 'fairshare_identity'

export interface LocalUser {
  id: string
  name: string
}

export function getLocalUser(): LocalUser | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LocalUser
  } catch {
    return null
  }
}

export function setLocalUser(name: string): LocalUser {
  const fp = fingerprint()
  const user: LocalUser = { id: fp, name }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  return user
}

export function clearLocalUser() {
  localStorage.removeItem(STORAGE_KEY)
  resetCryptoIdentity()
}

/** Returns the raw public key hex (for display / peer exchange). */
export function getPublicKeyHex(): string {
  return publicKeyHex()
}

/** Returns the local X25519 encryption public key as hex (for E2E recipients). */
export function getX25519PublicKeyHex(): string {
  return x25519PublicKeyHex()
}

/** Both public keys for the local identity, as hex. */
export function getIdentityKeys(): { publicKey: string; x25519PublicKey: string } {
  return { publicKey: publicKeyHex(), x25519PublicKey: x25519PublicKeyHex() }
}