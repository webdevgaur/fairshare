/**
 * FairShare Identity Module
 *
 * Manages the local user's identity backed by an Ed25519 keypair.
 * The user id is the public key fingerprint (8-char hex string).
 * The name is editable and persisted alongside the keypair.
 */
import { fingerprint, publicKeyHex, resetIdentity as resetCryptoIdentity } from './crypto'

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