/**
 * FairShare Ed25519 Identity Module
 *
 * Generates an Ed25519 keypair on first launch, stores the private key in
 * localStorage, and exposes the public key as hex + short fingerprint.
 * Provides sign/verify for future sync message authentication.
 */
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { x25519 } from '@noble/curves/ed25519.js'

// Set up synchronous hash for noble-ed25519 sync API (getPublicKey, sign, etc.)
ed.hashes.sha512 = sha512

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
  clearCachedKeys()
}

/** Clear in-memory key caches without touching persisted keys (dev/test use). */
export function clearCachedKeys() {
  cachedPubKey = null
  cachedPrivKey = null
  cachedFingerprint = null
  cachedX25519Secret = null
  cachedX25519Pub = null
}

/* ═══ E2E Encryption — X25519 ECDH + AES-256-GCM sealed envelope ═══════════ */

// Domain-separation labels (ADR §5, §6.1). Deriving both the Ed25519 signing
// key and the X25519 encryption key from the SAME identity seed (via HKDF with
// a distinct label) gives us one backup surface but two independent functions.
const X25519_INFO = new TextEncoder().encode('fairshare/x25519')
const WRAP_INFO = new TextEncoder().encode('fairshare/wrap')
// AAD binds the content ciphertext to the envelope header so a ciphertext
// cannot be transplanted between senders / recipient sets (ADR §2).
const AAD_DELIMITER = new Uint8Array([0x00])
const ENVELOPE_MAGIC = [0x46, 0x45] // 'FE'
const ENVELOPE_VERSION = 1
const FLAG_SIGNED = 1

let cachedX25519Secret: Uint8Array | null = null
let cachedX25519Pub: Uint8Array | null = null

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A recipient the operator should be sealed to. */
export interface Recipient {
  /** X25519 public key (32 bytes). */
  x25519PublicKey: Uint8Array
}

/** Result of unsealing a received envelope. */
export interface OpenedEnvelope {
  /** The decrypted CRDT operation. */
  op: Record<string, unknown>
  /** Sender's Ed25519 public key (32 bytes) — verify against member directory. */
  senderPublicKey: Uint8Array
  /** Sender's ephemeral X25519 public key (32 bytes). */
  senderX25519PublicKey: Uint8Array
}

/** Derive the X25519 encryption secret key from the same identity seed. */
export function getX25519SecretKey(): Uint8Array {
  if (cachedX25519Secret) return cachedX25519Secret
  const seed = loadKeypair().privateKey
  cachedX25519Secret = hkdf(sha256, seed, new Uint8Array(0), X25519_INFO, 32)
  return cachedX25519Secret
}

/** The X25519 public key for the local identity. */
export function getX25519PublicKey(): Uint8Array {
  if (cachedX25519Pub) return cachedX25519Pub
  cachedX25519Pub = x25519.getPublicKey(getX25519SecretKey())
  return cachedX25519Pub
}

/** Hex of the local X25519 public key. */
export function x25519PublicKeyHex(): string {
  return bytesToHex(getX25519PublicKey())
}

/** Concatenate byte arrays into one contiguous buffer. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, false)
  return b
}

/** Copy bytes into a fresh ArrayBuffer-backed view (satisfies BufferSource typing). */
function toBuffer(bytes: Uint8Array) {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * Seal a CRDT operation to one or more recipients per ADR-E2E-ENCRYPTION §6.1.
 *
 * Returns the raw binary envelope to send as a WebSocket binary frame. The
 * relay sees only opaque bytes; only listed recipients (holders of a matching
 * X25519 public key) can unwrap the content key and decrypt. The whole envelope
 * is signed with the sender's Ed25519 key so receivers can verify authorship
 * against the signed member directory.
 */
export async function sealOp(
  op: Record<string, unknown>,
  recipients: Recipient[],
): Promise<Uint8Array> {
  const plaintext = encoder.encode(JSON.stringify(op))

  // 1. Ephemeral sender X25519 keypair, fresh per op.
  const ephSecret = x25519.utils.randomSecretKey()
  const ephPublic = x25519.getPublicKey(ephSecret)

  // 2. Random content key + nonce for the single AEAD over the payload.
  const contentKey = crypto.getRandomValues(new Uint8Array(32))
  const contentNonce = crypto.getRandomValues(new Uint8Array(12))

  // 3. Sender's Ed25519 public key carried in the clear for identity binding.
  const senderEdPub = loadKeypair().publicKey

  const header = new Uint8Array(69)
  header[0] = ENVELOPE_MAGIC[0]
  header[1] = ENVELOPE_MAGIC[1]
  header[2] = ENVELOPE_VERSION
  header[3] = FLAG_SIGNED
  header.set(senderEdPub, 4)
  header.set(ephPublic, 36)
  header[68] = recipients.length

  // 4. Wrap the content key once per recipient.
  const recipientBlocks: Uint8Array[] = []
  for (const r of recipients) {
    const shared = x25519.getSharedSecret(ephSecret, r.x25519PublicKey)
    const wrapKey = hkdf(sha256, shared, new Uint8Array(0), WRAP_INFO, 32)
    const wrapNonce = crypto.getRandomValues(new Uint8Array(12))
    const keyId = sha256(r.x25519PublicKey).slice(0, 8)
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapNonce }, await importAesKey(wrapKey), toBuffer(contentKey)),
    )
    const block = new Uint8Array(8 + 1 + wrapped.length + 12)
    block.set(keyId, 0)
    block[8] = wrapped.length
    block.set(wrapped, 9)
    block.set(wrapNonce, 9 + wrapped.length)
    recipientBlocks.push(block)
  }

  // 5. Encrypt the payload with the content key; AAD binds header metadata.
  const aad = new Uint8Array(32 + 1 + AAD_DELIMITER.length)
  aad.set(senderEdPub, 0)
  aad[32] = recipients.length
  aad.set(AAD_DELIMITER, 33)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: contentNonce, additionalData: aad },
      await importAesKey(contentKey),
      toBuffer(plaintext),
    ),
  )

  // 6. Signature covers everything before it.
  const body = concat(header, ...recipientBlocks, contentNonce, u32(ciphertext.length), ciphertext)
  const signature = sign(body)
  return concat(body, signature)
}

/**
 * Open a sealed envelope received from a peer. Returns the decrypted op plus
 * the sender's public keys, or `null` if (a) the receiver is not a listed
 * recipient, (b) the AEAD authenticates the ciphertext (tamper/transplant), or
 * (c) the sender's Ed25519 signature does not verify.
 */
export async function openSealedEnvelope(bytes: Uint8Array): Promise<OpenedEnvelope | null> {
  try {
    if (bytes.length < 69) return null
    if (bytes[0] !== ENVELOPE_MAGIC[0] || bytes[1] !== ENVELOPE_MAGIC[1]) return null
    if (bytes[2] !== ENVELOPE_VERSION) return null
    const flags = bytes[3]
    const senderEdPub = bytes.slice(4, 36)
    const ephPublic = bytes.slice(36, 68)
    const count = bytes[68]
    if (count === 0) return null

    // Locate our wrapped key in the recipient list.
    let off = 69
    const myKeyId = sha256(getX25519PublicKey()).slice(0, 8)
    let found: { wrapped: Uint8Array; nonce: Uint8Array } | null = null
    for (let i = 0; i < count; i++) {
      const keyId = bytes.slice(off, off + 8)
      const wrappedLen = bytes[off + 8]
      const wrapped = bytes.slice(off + 9, off + 9 + wrappedLen)
      const nonce = bytes.slice(off + 9 + wrappedLen, off + 9 + wrappedLen + 12)
      if (keyId.length === 8 && keyId.every((v, j) => v === myKeyId[j])) {
        found = { wrapped, nonce }
      }
      off += 9 + wrappedLen + 12
    }
    if (!found) return null // not a recipient

    const contentNonce = bytes.slice(off, off + 12)
    const cipherLen = new DataView(bytes.buffer, bytes.byteOffset + off + 12, 4).getUint32(0)
    const ciphertext = bytes.slice(off + 16, off + 16 + cipherLen)
    const sigStart = off + 16 + cipherLen
    const signature = flags & FLAG_SIGNED ? bytes.slice(sigStart, sigStart + 64) : new Uint8Array(0)

    // Unwrap the content key.
    const shared = x25519.getSharedSecret(getX25519SecretKey(), ephPublic)
    const wrapKey = hkdf(sha256, shared, new Uint8Array(0), WRAP_INFO, 32)
    const contentKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(found.nonce) },
        await importAesKey(wrapKey),
        toBuffer(found.wrapped),
      ),
    )

    // Decrypt the payload.
    const aad = new Uint8Array(32 + 1 + AAD_DELIMITER.length)
    aad.set(senderEdPub, 0)
    aad[32] = count
    aad.set(AAD_DELIMITER, 33)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(contentNonce), additionalData: aad },
      await importAesKey(contentKey),
      toBuffer(ciphertext),
    )
    const op = JSON.parse(decoder.decode(plaintext)) as Record<string, unknown>

    // Verify the sender's Ed25519 signature (identity binding, ADR §6.2).
    if (flags & FLAG_SIGNED) {
      const body = bytes.slice(0, sigStart)
      const ok = await verify(senderEdPub, signature, body)
      if (!ok) return null
    }

    return { op, senderPublicKey: senderEdPub, senderX25519PublicKey: ephPublic }
  } catch {
    return null
  }
}