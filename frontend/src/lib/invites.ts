/**
 * FairShare Invite / QR Module (F8)
 *
 * Encodes and decodes identity QR payloads, builds invite links, and owns
 * pending-invite business logic. The encode/decode are pure functions; the
 * store-backed CRUD lives in store.ts / api.ts.
 */

/* ─── Identity QR ─── */

export interface IdentityQrPayload {
  t: 'identity'
  id: string
  name: string
  pubkey: string
}

/** Encode the local user's identity as a QR-friendly JSON string. */
export function encodeIdentityQR(userId: string, userName: string, pubKeyHex: string): string {
  return JSON.stringify({ t: 'identity', id: userId, name: userName, pubkey: pubKeyHex } satisfies IdentityQrPayload)
}

/** Parse an identity QR payload, returning null on malformed data. */
export function parseIdentityQR(raw: string): IdentityQrPayload | null {
  try {
    const obj = JSON.parse(raw)
    if (obj?.t === 'identity' && typeof obj.id === 'string' && typeof obj.name === 'string' && typeof obj.pubkey === 'string') {
      return obj as IdentityQrPayload
    }
    return null
  } catch {
    return null
  }
}

/**
 * Decode an identity QR payload and return the extracted fields.
 * Thin wrapper around parseIdentityQR that returns a flattened shape.
 */
export function decodeIdentityQR(data: string): { userId: string; name: string; pubkey: string } | null {
  const payload = parseIdentityQR(data)
  if (!payload) return null
  return { userId: payload.id, name: payload.name, pubkey: payload.pubkey }
}

/** Generate a cryptographically-random invite token. */
export function generateInviteToken(): string {
  return crypto.randomUUID()
}

/* ─── Invite Link ─── */

const INVITE_PREFIX = 'fairshare-invite:'

export interface InviteLinkPayload {
  t: 'invite'
  token: string
}

/** Build a shareable invite URL embedding the token. */
export function buildInviteLink(token: string, baseUrl?: string): string {
  const host = baseUrl ?? window.location.origin
  return `${host}/?invite=${encodeURIComponent(token)}`
}

/** Parse an invite token from a URL query string, or from a raw token. */
export function parseInviteLink(input: string): string | null {
  // Try extracting from a URL query parameter `?invite=<token>`
  try {
    const url = new URL(input, window.location.origin)
    const token = url.searchParams.get('invite')
    if (token) return token
  } catch {
    // Not a valid URL — fall through to raw token check
  }
  // Prefixed raw token
  if (input.startsWith(INVITE_PREFIX)) return input.slice(INVITE_PREFIX.length)
  return null
}

/** Encode a group invite as a QR-friendly JSON string (for QR display on the group page). */
export function encodeInviteQR(token: string): string {
  return JSON.stringify({ t: 'invite', token } satisfies InviteLinkPayload)
}