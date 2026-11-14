/**
 * IndexedDB blob storage for receipt images (F1).
 *
 * Receipt images are stored in IndexedDB, never localStorage: localStorage is
 * capped at 5–10MB and `JSON.stringify`ing binary is wasteful, while IndexedDB
 * stores real blobs with a much larger quota. The structured expense record
 * continues to live in the existing localStorage `LocalStore` — only the image
 * blob lives here, and it never leaves the device (the sync relay only ever
 * carries structured expense data).
 *
 * Under storage pressure a browser can evict IndexedDB; every operation is
 * best-effort. A failed image write must NOT block expense creation (the
 * structured expense is the source of truth), so callers treat `putReceipt`
 * failures as non-fatal.
 */

export interface ReceiptRecord {
  /** Scan uuid — the key this receipt is stored under. */
  id: string
  groupId: number
  createdAt: string
  /** The (compressed) receipt image. */
  image: Blob
  /** Best-effort parsed fields, kept for later viewing. */
  merchant?: string
  date?: string
  /** The uuids of the expenses created from this scan (for linking). */
  expenseUuids: string[]
}

const DB_NAME = 'fairshare_receipts'
const STORE = 'receipts'
const VERSION = 1
/** Soft cap on stored receipts; oldest are evicted beyond this. */
const MAX_RECEIPTS = 100

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txAsPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * Persist a receipt image record. Best-effort: a quota/eviction failure is
 * rethrown (caller decides whether to degrade), but a successful write is
 * followed by an eviction pass to keep the store under `MAX_RECEIPTS`.
 */
export async function putReceipt(record: ReceiptRecord): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    await txAsPromise(tx)
  } finally {
    try {
      await evictOverCap(db)
    } catch {
      /* best-effort */
    }
  }
}

/** Fetch a stored receipt by scan uuid, or null if absent. */
export async function getReceipt(id: string): Promise<ReceiptRecord | null> {
  const db = await openDb()
  const rec = await reqAsPromise(db.transaction(STORE).objectStore(STORE).get(id))
  return (rec as ReceiptRecord) ?? null
}

/** Delete a stored receipt. Resolves even if it did not exist. */
export async function deleteReceipt(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txAsPromise(tx)
}

/** List receipts, optionally filtered to one group, newest first. */
export async function listReceipts(groupId?: number): Promise<ReceiptRecord[]> {
  const db = await openDb()
  const all = await reqAsPromise(db.transaction(STORE).objectStore(STORE).getAll())
  const records = (all as ReceiptRecord[]).filter((r) => (groupId === undefined ? true : r.groupId === groupId))
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function evictOverCap(db: IDBDatabase): Promise<void> {
  const count = await reqAsPromise(db.transaction(STORE).objectStore(STORE).count())
  if (count <= MAX_RECEIPTS) return
  const all = await reqAsPromise(db.transaction(STORE).objectStore(STORE).getAll())
  const records = (all as ReceiptRecord[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const toDelete = records.slice(0, records.length - MAX_RECEIPTS)
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const r of toDelete) store.delete(r.id)
  await txAsPromise(tx)
}
