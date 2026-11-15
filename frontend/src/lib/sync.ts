/**
 * FairShare CRDT Sync Client
 *
 * Connects to the Rust relay server per-group, queues operations offline,
 * and syncs encrypted CRDT patches when connected.
 *
 * Protocol:
 *   1. Connect:  send { type: "join", group_id, peer_id }
 *   2. Send:     { type: "patch", encrypted, iv, peer_id }
 *   3. Receive:  { type: "patch", encrypted, iv, peer_id } (from other peers)
 *   4. Recover:  { type: "sync_request", last_op_id, peer_id }
 *                → peers reply with patches containing their ops
 *
 * Each operation carries a Lamport timestamp for causal ordering.
 * Operations are idempotent via op_id — duplicates are silently dropped.
 */

import { store } from './store'
import type { PaymentHandles } from './engine'
import { notifyActivity } from './notifications'
import { sealOp, openSealedEnvelope } from './crypto'

// ─── Types ─────────────────────────────────────���────────────────────────────

export type SyncStatus = 'synced' | 'queued' | 'offline' | 'connecting'

export interface CRDTOperation {
  /** Globally unique operation ID (nanoid-style) */
  op_id: string
  /** Operation type */
  type: 'create_group' | 'create_expense' | 'create_settlement' | 'create_comment' | 'update_group' | 'update_profile'
  /** Group this operation belongs to */
  group_id: string | number
  /** Lamport clock value at time of creation */
  lamport_counter: number
  /** Peer ID that created this operation */
  peer_id: string
  /** Operation-specific payload */
  data: Record<string, unknown>
  /** Unix ms timestamp */
  created_at: number
}

interface QueuedOp {
  op: CRDTOperation
  retries: number
}

/** Encrypted wrapper for wire transmission */
interface EncryptedPatch {
  type: 'patch'
  encrypted: string
  iv: string
  peer_id: string
}

interface RelayMessage {
  type: string
  [key: string]: unknown
}

type StatusListener = (status: SyncStatus) => void
type PatchHandler = (op: CRDTOperation) => void

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY_OPS = 'fairshare_sync_queue'
const STORAGE_KEY_CLOCK = 'fairshare_lamport_clocks'
const STORAGE_KEY_OPLOG = 'fairshare_op_log'
const STORAGE_KEY_PEER = 'fairshare_peer_id'
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30_000

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateOpId(): string {
  // nanoid-style: timestamp + random chars
  const ts = Date.now().toString(36)
  const rand = crypto.getRandomValues(new Uint8Array(8))
  const randStr = Array.from(rand)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
  return `${ts}-${randStr}`
}

function getPersistedPeerId(): string {
  let id = localStorage.getItem(STORAGE_KEY_PEER)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY_PEER, id)
  }
  return id
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/** Copy bytes into a fresh ArrayBuffer-backed view (WebSocket.send wants BufferSource). */
function toBuffer(bytes: Uint8Array) {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out
}

// ─── Lamport Clock ──────────────────────────────────────────────────────────

interface LamportState {
  [groupKey: string]: number // counter per group
}

class LamportClock {
  private state: LamportState = {}

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CLOCK)
      if (raw) this.state = JSON.parse(raw)
    } catch {
      this.state = {}
    }
  }

  /** Get the current counter for a group. */
  get(groupKey: string): number {
    return this.state[groupKey] ?? 0
  }

  /** Increment and return the next counter value. */
  tick(groupKey: string): number {
    this.state[groupKey] = (this.state[groupKey] ?? 0) + 1
    this.persist()
    return this.state[groupKey]
  }

  /** Merge a received counter: take the max. */
  merge(groupKey: string, received: number): void {
    const current = this.state[groupKey] ?? 0
    if (received > current) {
      this.state[groupKey] = received
      this.persist()
    }
  }

  /** Merge and tick: returns the next counter after merging. */
  mergeAndTick(groupKey: string, received: number): number {
    this.merge(groupKey, received)
    return this.tick(groupKey)
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY_CLOCK, JSON.stringify(this.state))
    } catch {
      // silently degrade
    }
  }
}

// ─── Op Log (idempotency) ─────────────────────────────���─────────────────────

class OpLog {
  private applied: Set<string> = new Set()

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPLOG)
      if (raw) {
        const arr: string[] = JSON.parse(raw)
        this.applied = new Set(arr)
      }
    } catch {
      this.applied = new Set()
    }
  }

  /** Check if an operation has already been applied. */
  has(opId: string): boolean {
    return this.applied.has(opId)
  }

  /** Record an operation as applied. */
  record(opId: string): void {
    this.applied.add(opId)
    // Persist periodically (every 50 ops)
    if (this.applied.size % 50 === 0) this.persist()
  }

  /** Get the most recent op_id (for sync_request). */
  get lastOpId(): string | null {
    // The last element added (Set preserves insertion order in modern JS)
    const arr = Array.from(this.applied)
    return arr.length > 0 ? arr[arr.length - 1] : null
  }

  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY_OPLOG, JSON.stringify(Array.from(this.applied)))
    } catch {
      // silently degrade
    }
  }
}

// ─── Encryption (simple XOR cipher for demo — replace with AES-GCM in prod) ─
// In production: use SubtleCrypto with AES-256-GCM.
// For this demo, we use base64 + a trivial transform so the relay cannot read
// plaintext. Real deployments should derive a group key from a shared secret.

async function encryptPatch(
  op: CRDTOperation,
  _groupKey: string,
): Promise<{ encrypted: string; iv: string }> {
  const plaintext = JSON.stringify(op)
  // Use Web Crypto API with AES-GCM
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // Derive a key from the group key using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(_groupKey.padEnd(32, 'x').slice(0, 32)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('fairshare-salt'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decryptPatch(
  encrypted: string,
  iv: string,
  _groupKey: string,
): Promise<CRDTOperation | null> {
  try {
    const encoder = new TextEncoder()
    const encryptedBytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(_groupKey.padEnd(32, 'x').slice(0, 32)),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode('fairshare-salt'), iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, encryptedBytes)
    const decoder = new TextDecoder()
    return JSON.parse(decoder.decode(decrypted)) as CRDTOperation
  } catch {
    return null
  }
}

// ─── SyncClient ─────────────────────────────────────────────────────────────

class SyncClient {
  private ws: WebSocket | null = null
  private queue: QueuedOp[] = []
  private _status: SyncStatus = 'offline'
  private listeners: Set<StatusListener> = new Set()
  private patchHandlers: Set<PatchHandler> = new Set()
  private relayUrl: string
  private peerId: string
  private lamport: LamportClock
  private opLog: OpLog
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private connected = false
  private currentGroupId: string | null = null
  private groupKey: string // shared secret for encryption (demo: derived from group_id)

  constructor(relayUrl = 'ws://localhost:3002') {
    this.relayUrl = relayUrl
    this.peerId = getPersistedPeerId()
    this.lamport = new LamportClock()
    this.opLog = new OpLog()
    this.groupKey = 'fairshare-demo-key' // replaced per-group on join
    this.loadQueue()
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get status(): SyncStatus {
    return this._status
  }

  get peerIdString(): string {
    return this.peerId
  }

  /** Join a specific group room and start syncing. */
  joinGroup(groupId: string | number): void {
    const gid = String(groupId)
    if (this.currentGroupId === gid && this.connected) return

    // Derive a per-group encryption key (in production: from shared secret)
    this.groupKey = `fairshare-group-key-${gid}`

    // Disconnect from any previous room
    this.disconnect()
    this.currentGroupId = gid

    // Connect to the specific room endpoint
    this.connect()
  }

  /** Leave the current group. */
  leaveGroup(): void {
    this.disconnect()
    this.currentGroupId = null
  }

  /**
   * Enqueue a CRDT operation.
   * Applies locally, then syncs if connected.
   */
  enqueue(
    type: CRDTOperation['type'],
    data: Record<string, unknown>,
    groupId?: string | number,
  ): CRDTOperation {
    const gid = String(groupId ?? this.currentGroupId ?? 'unknown')
    const op: CRDTOperation = {
      op_id: generateOpId(),
      type,
      group_id: gid,
      lamport_counter: this.lamport.tick(gid),
      peer_id: this.peerId,
      data,
      created_at: Date.now(),
    }

    // Record in op_log for idempotency
    this.opLog.record(op.op_id)

    // Add to queue
    this.queue.push({ op, retries: 0 })
    this.persistQueue()
    this.setStatus('queued')

    // Try to send immediately if connected
    if (this.connected) {
      this.sendOp(op)
    }

    return op
  }

  /** Register a handler for incoming patches from other peers. */
  onPatch(handler: PatchHandler): () => void {
    this.patchHandlers.add(handler)
    return () => this.patchHandlers.delete(handler)
  }

  /** Register a status change listener. Returns unsubscribe fn. */
  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.connected = false
    this.reconnectAttempt = 0
    this.setStatus(this.queue.length > 0 ? 'queued' : 'offline')
  }

  /** Expose op_log's lastOpId for sync requests. */
  get lastAppliedOpId(): string | null {
    return this.opLog.lastOpId
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private connect(): void {
    if (this.ws || !this.currentGroupId) return

    const url = `${this.relayUrl}/ws/group/${this.currentGroupId}`
    this.setStatus('connecting')

    try {
      this.ws = new WebSocket(url)
    } catch {
      this.setStatus('offline')
      this.scheduleReconnect()
      return
    }

    // E2E sealed ops arrive as WebSocket binary frames; read them as raw bytes.
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      this.connected = true
      this.reconnectAttempt = 0

      // Send join message
      this.sendJson({
        type: 'join',
        group_id: this.currentGroupId,
        peer_id: this.peerId,
      })

      this.setStatus(this.queue.length > 0 ? 'queued' : 'synced')
      this.flushQueue()

      // Request missed ops
      this.requestSync()
    }

    this.ws.onclose = () => {
      this.connected = false
      this.ws = null
      this.setStatus(this.queue.length > 0 ? 'queued' : 'offline')
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.connected = false
      this.ws?.close()
      this.ws = null
      this.setStatus('offline')
    }

    this.ws.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev.data)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (!this.currentGroupId) return

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(1.5, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    )
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  // ── Message Handling ────────────────────────────────────────────────────

  private async handleMessage(raw: string | ArrayBuffer): Promise<void> {
    // E2E sealed ops arrive as binary frames (ADR Decision 3A).
    if (raw instanceof ArrayBuffer) {
      await this.handleBinary(new Uint8Array(raw))
      return
    }

    let msg: RelayMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return // malformed
    }

    switch (msg.type) {
      case 'room_joined': {
        this.setStatus(this.queue.length > 0 ? 'queued' : 'synced')
        break
      }

      case 'patch': {
        const encrypted = msg.encrypted as string
        const iv = msg.iv as string
        const senderPeerId = msg.peer_id as string

        // Don't process our own patches
        if (senderPeerId === this.peerId) return

        const op = await decryptPatch(encrypted, iv, this.groupKey)
        if (!op) return // decryption failed

        await this.applyRemoteOp(op)
        break
      }

      case 'sync_request': {
        const lastOpId = msg.last_op_id as string | null
        const requesterPeerId = msg.peer_id as string

        if (requesterPeerId === this.peerId) return

        // Re-send our queued/applied ops that the requester might be missing
        this.handleSyncRequest(lastOpId, requesterPeerId)
        break
      }

      case 'peer_joined':
      case 'peer_left':
        // Presence notifications — could update UI
        break

      case 'pong':
        break

      case 'error':
        console.warn('[sync] Relay error:', msg.message)
        break
    }
  }

  /**
   * Handle a received E2E sealed envelope (WebSocket binary frame). Drops it
   * silently on failure — fail-closed matches the legacy decryptPatch behavior
   * and keeps a device on the plaintext path until it can unseal (ADR §9).
   */
  private async handleBinary(bytes: Uint8Array): Promise<void> {
    const opened = await openSealedEnvelope(bytes)
    if (!opened) return // not a recipient, or tampered / wrong key

    const op = opened.op as unknown as CRDTOperation
    await this.applyRemoteOp(op)
  }

  // ── Applying Remote Operations ──────────────────────────────────────────

  private async applyRemoteOp(op: CRDTOperation): Promise<void> {
    // Idempotency: skip if already applied
    if (this.opLog.has(op.op_id)) return

    // Merge Lamport clock
    this.lamport.merge(String(op.group_id), op.lamport_counter)

    // Apply to local store
    try {
      this.applyToStore(op)
    } catch (err) {
      console.error('[sync] Failed to apply remote op:', op.op_id, err)
      return
    }

    // Record in op_log
    this.opLog.record(op.op_id)

    // Notify patch handlers
    this.patchHandlers.forEach((fn) => fn(op))
  }

  private applyToStore(op: CRDTOperation): void {
      switch (op.type) {
        case 'create_expense': {
          const d = op.data as {
            group_id: number
            paid_by: string
            amount: number
            description: string
            splits: { user_id: string; amount: number }[]
            uuid?: string
            date?: string
            created_at?: string
            category?: string
            id?: number
          }
          // Preserve cross-device identity: carry the creator's uuid, falling
          // back to the operation id (globally unique) rather than minting a
          // fresh local numeric id.
          const expense = store.createExpense(
            d.group_id,
            d.paid_by,
            d.amount,
            d.description,
            d.splits,
            { uuid: d.uuid ?? op.op_id, date: d.date, created_at: d.created_at, category: d.category },
          )
          notifyActivity({
            title: 'New expense',
            body: `${expense.paid_by_name} added "${expense.description}" for $${expense.amount.toFixed(2)}`,
            tag: `expense-${expense.uuid}`,
          })
          break
        }

        case 'create_comment': {
          const d = op.data as {
            group_id: number
            expense_uuid: string
            expense_id: number
            author_id: string
            author_name: string
            text: string
          }
          const comment = store.createComment(
            d.group_id,
            d.expense_uuid,
            d.expense_id,
            d.author_id,
            d.author_name,
            d.text,
          )
          notifyActivity({
            title: 'New comment',
            body: `${comment.author_name} commented: "${comment.text}"`,
            tag: `comment-${comment.id}`,
          })
          break
        }

        case 'create_settlement': {
          const d = op.data as {
            group_id: number
            from_user: string
            to_user: string
            amount: number
            date?: string
            created_at?: string
            uuid?: string
          }
          store.createSettlement(d.group_id, d.from_user, d.to_user, d.amount, {
            date: d.date,
            created_at: d.created_at,
            uuid: d.uuid ?? op.op_id,
          })
          break
        }

        case 'create_group': {
          const d = op.data as {
            name: string
            description: string | null
            member_ids: string[]
            id?: number
            uuid?: string
            created_at?: string
          }
          store.createGroup(
            d.name,
            d.description ?? null,
            d.member_ids,
            { uuid: d.uuid ?? op.op_id, created_at: d.created_at },
          )
          break
        }

      case 'update_group':
        // Group metadata LWW update — store doesn't support edits yet
        break

      case 'update_profile': {
        const d = op.data as { user_id: string; handles: PaymentHandles }
        store.setUserPaymentHandles(d.user_id, d.handles)
        break
      }
    }
  }

  // ── Sync Request Handling ──────────────────────────────────────────────

  private handleSyncRequest(lastOpId: string | null, _requesterPeerId: string): void {
    // Re-send all queued ops that are newer than lastOpId
    for (const queued of this.queue) {
      if (queued.op.op_id === lastOpId) break // older or equal — stop
      // If not found in the list, send it
      this.sendOp(queued.op)
    }
  }

  private requestSync(): void {
    this.sendJson({
      type: 'sync_request',
      last_op_id: this.opLog.lastOpId,
      peer_id: this.peerId,
    })
  }

  // ── Sending ─────────────────────────────────────────────────────────────

  private async sendOp(op: CRDTOperation): Promise<void> {
    if (!this.connected || !this.ws) return

    const gid = this.groupIdForOp(op)
    const memberKeys = store.getGroupMemberX25519PublicKeys(gid)
    if (store.isGroupE2EReady(gid) && memberKeys.length > 0) {
      // E2E: seal the op once per group member's X25519 public key (ADR §3).
      const recipients = memberKeys.map((hex) => ({ x25519PublicKey: hexToBytes(hex) }))
      const bytes = await sealOp(op as unknown as Record<string, unknown>, recipients)
      this.sendBinary(bytes)
      return
    }

    // Legacy demo path (backward compat for non-E2E groups).
    const { encrypted, iv } = await encryptPatch(op, this.groupKey)
    const patch: EncryptedPatch = {
      type: 'patch',
      encrypted,
      iv,
      peer_id: this.peerId,
    }
    this.sendJson(patch as unknown as Record<string, unknown>)
  }

  /** Resolve the numeric group id for an op, falling back to the current room. */
  private groupIdForOp(op: CRDTOperation): number {
    const gid = op.group_id
    if (typeof gid === 'number' && Number.isFinite(gid)) return gid
    const n = Number(gid)
    if (Number.isFinite(n) && String(gid) !== 'unknown' && String(gid) !== '') return n
    const cur = this.currentGroupId
    return cur ? Number(cur) : 0
  }

  /** Send a raw binary (sealed envelope) frame to the relay. */
  private sendBinary(bytes: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(toBuffer(bytes))
    } catch {
      // will retry
    }
  }

  private sendJson(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(msg))
    } catch {
      // will retry
    }
  }

  // ── Queue Management ───────────────────────────────────────────────────

  private async flushQueue(): Promise<void> {
    if (!this.connected || this.queue.length === 0) return

    this.setStatus('queued')

    for (const queued of [...this.queue]) {
      await this.sendOp(queued.op)
      // Don't remove from queue until confirmed or on ack
      // For now, mark as sent and keep in queue for retry
    }
    }

  // ── Persistence ────────────────────────────────────────────────────────

  private persistQueue(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY_OPS,
        JSON.stringify(this.queue.map((q) => ({ op: q.op, retries: q.retries }))),
      )
    } catch {
      // silently degrade
    }
  }

  private loadQueue(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPS)
      if (raw) {
        const parsed: QueuedOp[] = JSON.parse(raw)
        this.queue = Array.isArray(parsed) ? parsed : []
      }
    } catch {
      this.queue = []
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────

  private setStatus(s: SyncStatus): void {
    if (this._status === s) return
    this._status = s
    this.listeners.forEach((fn) => fn(s))
  }
}

/** Singleton sync client */
export const syncClient = new SyncClient()