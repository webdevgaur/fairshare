/**
 * FairShare Export / Import — F5
 *
 * Serializes the full store (JSON) and flattens it to spreadsheets (CSV),
 * and imports JSON back (merge / restore) or migrates from a Splitwise CSV
 * export.
 *
 * Zero new dependencies: the JSON type guard and the CSV reader/writer are
 * hand-rolled so users can trust and inspect the code that moves their data.
 */
import { store, type StoreState } from './store'
import type {
  UserRecord,
  GroupRecord,
  GroupMemberRecord,
  ExpenseRecord,
  ExpenseSplitRecord,
  SettlementRecord,
  CommentRecord,
  CoupleRecord,
} from './store'

/* ─── JSON envelope ─── */

const FORMAT = 'fairshare-export'
const SOURCE_APP = 'fairshare'
const CURRENT_SCHEMA_VERSION = 3

export interface ExportEnvelope {
  format: typeof FORMAT
  schema_version: number
  exported_at: string
  source_app: typeof SOURCE_APP
  data: StoreState
}

/**
 * Serialize the full store state into a pretty-printed JSON export envelope.
 * Round-trip compatible: the `data` payload can be imported back verbatim
 * (restore) or merged by uuid (default).
 */
export function exportJSON(): string {
  const envelope: ExportEnvelope = {
    format: FORMAT,
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    source_app: SOURCE_APP,
    data: store.getAllData(),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Parse and validate a JSON export envelope.
 * Throws a user-facing Error on a malformed file, a version from the future,
 * or an invalid data payload. Never partially applies.
 */
export function parseJSON(text: string): { data: StoreState; schema_version: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('This file is not a FairShare export.')
  const o = parsed as Record<string, unknown>
  if (o.format !== FORMAT) throw new Error('This file is not a FairShare export (missing format marker).')
  if (typeof o.schema_version !== 'number') throw new Error('This export is missing a schema_version.')
  // Accept current and older versions (migrated below); only reject a future
  // version, since a newer app may have stores this one can't represent.
  if (o.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new Error('This export was created by a newer version of FairShare. Please update the app.')
  }
  if (!isStoreState(o.data)) throw new Error('The export data is malformed or incomplete.')
  const data = o.data as StoreState
  // F9 migration: files exported before couple mode carry no `couples` array and
  // no per-group `couple_mode`. Default them so downstream code (and the store's
  // merge/replace path) never sees an undefined array. `couple_mode` defaults to
  // undefined = OFF, and `couples` to an empty list.
  if (o.schema_version < CURRENT_SCHEMA_VERSION) {
    if (!Array.isArray(data.couples)) {
      ;(data as { couples: CoupleRecord[] }).couples = []
    }
    for (const g of data.groups) {
      if (g.couple_mode === undefined) {
        ;(g as { couple_mode?: boolean }).couple_mode = undefined
      }
    }
    // F10 migration: files exported before the activity log carry no `activityLog`
    // array or `nextActivityId` counter. Default them so downstream code never sees
    // an undefined array.
    if (!Array.isArray(data.activityLog)) {
      ;(data as { activityLog: unknown[] }).activityLog = []
    }
    if (!data.nextActivityId) {
      ;(data as { nextActivityId: number }).nextActivityId = 1
    }
  }
  return { data, schema_version: o.schema_version }
}

/* ─── Runtime type guard (hand-rolled — no zod/ajv) ─── */

function isRecord(r: unknown): r is Record<string, unknown> {
  return typeof r === 'object' && r !== null
}
function isString(r: unknown): r is string {
  return typeof r === 'string'
}
function isNumber(r: unknown): r is number {
  return typeof r === 'number' && Number.isFinite(r)
}

function isUserRecord(r: unknown): r is UserRecord {
  return isRecord(r) && isString(r.id) && isString(r.name)
}
function isGroupRecord(r: unknown): r is GroupRecord {
  return (
    isRecord(r) &&
    isNumber(r.id) &&
    isString(r.uuid) &&
    isString(r.name) &&
    (r.couple_mode === undefined || typeof r.couple_mode === 'boolean')
  )
}
function isCoupleRecord(r: unknown): r is CoupleRecord {
  return (
    isRecord(r) &&
    isNumber(r.id) &&
    isString(r.uuid) &&
    isString(r.user_a) &&
    isString(r.user_b)
  )
}
function isGroupMemberRecord(r: unknown): r is GroupMemberRecord {
  return isRecord(r) && isNumber(r.group_id) && isString(r.user_id)
}
function isExpenseRecord(r: unknown): r is ExpenseRecord {
  return (
    isRecord(r) &&
    isNumber(r.id) &&
    isString(r.uuid) &&
    isNumber(r.group_id) &&
    isString(r.paid_by) &&
    isNumber(r.amount)
  )
}
function isExpenseSplitRecord(r: unknown): r is ExpenseSplitRecord {
  return isRecord(r) && isNumber(r.id) && isNumber(r.expense_id) && isString(r.user_id) && isNumber(r.amount)
}
function isSettlementRecord(r: unknown): r is SettlementRecord {
  return (
    isRecord(r) &&
    isNumber(r.id) &&
    isString(r.uuid) &&
    isNumber(r.group_id) &&
    isString(r.from_user) &&
    isString(r.to_user) &&
    isNumber(r.amount)
  )
}
function isCommentRecord(r: unknown): r is CommentRecord {
  return isRecord(r) && isNumber(r.id) && isString(r.expense_uuid) && isString(r.author_id)
}
function isActivityLogEntryRecord(r: unknown): r is Record<string, unknown> {
  return isRecord(r) && isNumber(r.id) && isString(r.uuid) && isNumber(r.group_id) && isString(r.type) && isString(r.actor_id)
}

function isRecordArray(r: unknown, check: (x: unknown) => boolean): boolean {
  return Array.isArray(r) && r.every(check)
}

function isStoreState(v: unknown): v is StoreState {
  if (!isRecord(v)) return false
  const o = v as Record<string, unknown>
  return (
    isRecordArray(o.users, isUserRecord) &&
    isRecordArray(o.groups, isGroupRecord) &&
    isRecordArray(o.groupMembers, isGroupMemberRecord) &&
    isRecordArray(o.expenses, isExpenseRecord) &&
    isRecordArray(o.expenseSplits, isExpenseSplitRecord) &&
    isRecordArray(o.settlements, isSettlementRecord) &&
    isRecordArray(o.comments, isCommentRecord) &&
    (o.couples === undefined || isRecordArray(o.couples, isCoupleRecord)) &&
    (o.activityLog === undefined || isRecordArray(o.activityLog, isActivityLogEntryRecord))
  )
}

/* ─── CSV writer (RFC-4180, CRLF, BOM) ─── */

/** Quote a single CSV field per RFC-4180, neutralizing spreadsheet formula prefixes. */
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  // CWE-1236: a leading formula trigger (=, +, -, @) reached Excel/Sheets would
  // be evaluated as a formula. Force quoting so it stays literal text.
  if (/[",\r\n]/.test(s) || /^[=+\-@]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Serialize rows to a CSV string with a BOM and CRLF line endings. */
function buildCSV(rows: (string | number | null | undefined)[][]): string {
  const body = rows.map((row) => row.map(csvField).join(',')).join('\r\n')
  return '\uFEFF' + body + '\r\n'
}

/**
 * Parse a CSV string into rows of fields. RFC-4180-aware: handles a leading
 * BOM, quoted fields containing commas/newlines, and escaped quotes.
 */
export function parseCSV(text: string): string[][] {
  let body = text
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      if (body[i + 1] === '\n') i += 2
      else i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (ch === '\n') {
      i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/* ─── CSV export (flattened, human-readable) ─── */

export interface CSVFile {
  filename: string
  content: string
}

/** Build `expenses.csv` — one row per expense, joined to names. */
export function buildExpensesCSV(): string {
  const data = store.getAllData()
  const nameById = new Map(data.users.map((u) => [u.id, u.name]))
  const groupNameById = new Map(data.groups.map((g) => [g.id, g.name]))
  const rows: (string | number | null)[][] = [
    ['uuid', 'date', 'description', 'category', 'amount', 'group_name', 'paid_by_name', 'participants', 'split', 'created_at'],
  ]
  for (const e of data.expenses) {
    const splits = data.expenseSplits.filter((s) => s.expense_id === e.id)
    const participants = splits.map((s) => nameById.get(s.user_id) ?? 'Unknown')
    const splitDescription = splits.map((s) => `${nameById.get(s.user_id) ?? 'Unknown'}:${s.amount.toFixed(2)}`)
    rows.push([
      e.uuid,
      e.date,
      e.description,
      e.category ?? '',
      e.amount,
      groupNameById.get(e.group_id) ?? String(e.group_id),
      nameById.get(e.paid_by) ?? 'Unknown',
      participants.join('; '),
      splitDescription.join('; '),
      e.created_at,
    ])
  }
  return buildCSV(rows)
}

/** Build `settlements.csv` — one row per settlement, joined to names. */
export function buildSettlementsCSV(): string {
  const data = store.getAllData()
  const nameById = new Map(data.users.map((u) => [u.id, u.name]))
  const groupNameById = new Map(data.groups.map((g) => [g.id, g.name]))
  const rows: (string | number | null)[][] = [
    ['uuid', 'date', 'amount', 'group_name', 'from_user', 'to_user', 'created_at'],
  ]
  for (const s of data.settlements) {
    rows.push([
      s.uuid,
      s.date,
      s.amount,
      groupNameById.get(s.group_id) ?? String(s.group_id),
      nameById.get(s.from_user) ?? 'Unknown',
      nameById.get(s.to_user) ?? 'Unknown',
      s.created_at,
    ])
  }
  return buildCSV(rows)
}

/** Build `groups.csv` — one row per group. */
export function buildGroupsCSV(): string {
  const data = store.getAllData()
  const rows: (string | number | null)[][] = [['id', 'uuid', 'name', 'description', 'created_at']]
  for (const g of data.groups) {
    rows.push([g.id, g.uuid, g.name, g.description, g.created_at])
  }
  return buildCSV(rows)
}

/** Build all three CSV export files. */
export function buildCSVBundle(): CSVFile[] {
  return [
    { filename: 'expenses.csv', content: buildExpensesCSV() },
    { filename: 'settlements.csv', content: buildSettlementsCSV() },
    { filename: 'groups.csv', content: buildGroupsCSV() },
  ]
}

/* ─── Splitwise CSV import adapter ─── */

export interface SplitwiseResult {
  state: StoreState
  /** Human-readable notes about rows that were skipped (unparseable). */
  skipped: string[]
}

/** Detect whether a text blob looks like a Splitwise group CSV export. */
export function isSplitwiseCSV(text: string): boolean {
  const rows = parseCSV(text)
  if (rows.length === 0) return false
  const header = rows[0].map((h) => h.trim().toLowerCase())
  return header.includes('date') && header.includes('cost') && header.includes('currency')
}

/** Normalise a date to ISO `YYYY-MM-DD`. Handles US `M/D/YYYY` and ISO. */
export function normalizeDate(raw: string): string {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const month = m[1].padStart(2, '0')
    const day = m[2].padStart(2, '0')
    let year = m[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  return s
}

function emptyImportState(): StoreState {
  return {
    users: [],
    groups: [],
    groupMembers: [],
    expenses: [],
    expenseSplits: [],
    settlements: [],
    comments: [],
    couples: [],
    pendingInvites: [],
    nextGroupId: 1,
    nextExpenseId: 1,
    nextSettlementId: 1,
    nextSplitId: 1,
    nextCommentId: 1,
    nextCoupleId: 1,
    nextInviteId: 1,
    activityLog: [],
    nextActivityId: 1,
    disputes: [],
    nextDisputeId: 1,
  }
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a Splitwise group CSV export into a StoreState. Splitwise's export has
 * fixed rows of: Date, Description, Category, Cost, Currency, then one column
 * per member holding that member's NET change (amount paid − share owed). The
 * payer is the member with the largest net value; each member's share is
 * recovered from the net column. Unparseable rows are reported, not dropped
 * silently, and the rest are still imported.
 */
export function parseSplitwiseCSV(text: string, groupName?: string): SplitwiseResult {
  const rows = parseCSV(text)
  const skipped: string[] = []
  if (rows.length < 2) {
    return { state: emptyImportState(), skipped: ['File has no data rows.'] }
  }

  const header = rows[0].map((h) => h.trim())
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const dateI = col('Date')
  const descI = col('Description')
  const catI = col('Category')
  const costI = col('Cost')
  const curI = col('Currency')
  const paidByI = col('Paid By')

  if (dateI < 0 || descI < 0 || costI < 0 || curI < 0) {
    throw new Error(
      'Not a recognized Splitwise CSV. Expected columns: Date, Description, Category, Cost, Currency, <member…>.',
    )
  }

  // Member columns = everything after the five fixed columns, excluding any
  // explicit "Paid By"/"Group" column that a variant export may carry.
  const memberCols: number[] = []
  for (let c = 5; c < header.length; c++) {
    if (c === paidByI) continue
    if (header[c].toLowerCase() === 'group') continue
    const name = header[c].trim()
    if (!name) continue
    memberCols.push(c)
  }
  if (memberCols.length === 0) {
    throw new Error('No member columns found in the Splitwise CSV.')
  }

  const state = emptyImportState()
  const now = new Date().toISOString()
  const todaySeed = now.slice(0, 10)

  // Build the destination group and member records (map names → users).
  const groupId = 1
  const groupUuid = crypto.randomUUID()
  const groupLabel = (groupName ?? 'Imported from Splitwise').trim() || 'Imported from Splitwise'
  state.groups.push({ id: groupId, uuid: groupUuid, name: groupLabel, description: null, created_at: todaySeed })

  const memberUserIdByCol: Record<number, string> = {}
  for (const c of memberCols) {
    const name = header[c].trim()
    let user = state.users.find((u) => u.name === name)
    if (!user) {
      user = { id: crypto.randomUUID(), name }
      state.users.push(user)
    }
    memberUserIdByCol[c] = user.id
    state.groupMembers.push({ group_id: groupId, user_id: user.id })
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const label = `row ${i + 1}`

    // Skip a totally blank line or the trailing "Total balance" summary row.
    const cells = row.map((c) => (c ?? '').trim())
    if (cells.every((c) => c === '')) continue
    if (/^total\b/i.test(cells.join(' '))) {
      skipped.push(`${label}: "Total balance" summary row skipped.`)
      continue
    }

    const cost = parseAmount(row[costI])
    const category = catI >= 0 ? (row[catI] ?? '').trim() : ''
    // Splitwise marks settle-up transfers as category "Payment" — not an expense.
    if (category.toLowerCase() === 'payment') {
      skipped.push(`${label}: payment/settle-up row skipped (not an expense).`)
      continue
    }
    if (cost === null || cost <= 0) {
      skipped.push(`${label}: missing or non-positive cost; skipped.`)
      continue
    }

    const description = (row[descI] ?? '').trim() || 'Expense'
    const date = normalizeDate(row[dateI] ?? '')

    // Net (paid − share) per member; sum of net should be ~0.
    const netByCol: Record<number, number> = {}
    let netSum = 0
    let anyMember = false
    for (const c of memberCols) {
      const net = parseAmount(row[c]) ?? 0
      netByCol[c] = net
      netSum += net
      if (net !== 0) anyMember = true
    }
    if (!anyMember) {
      skipped.push(`${label}: no member shares; skipped.`)
      continue
    }
    if (Math.abs(netSum) > 0.05) {
      skipped.push(`${label}: member shares do not sum to zero (${netSum.toFixed(2)}); skipped.`)
      continue
    }

    // Payer = the member with the largest net (the one who paid).
    let payerCol = memberCols[0]
    for (const c of memberCols) {
      if ((netByCol[c] ?? 0) > (netByCol[payerCol] ?? 0)) payerCol = c
    }
    if (paidByI >= 0 && (row[paidByI] ?? '').trim()) {
      const paidName = row[paidByI].trim()
      const paidCol = memberCols.find((c) => header[c].trim() === paidName)
      if (paidCol !== undefined) payerCol = paidCol
    }
    const payerId = memberUserIdByCol[payerCol]
    if (!payerId) {
      skipped.push(`${label}: unknown payer; skipped.`)
      continue
    }

    // Recover shares: payer share = cost − payer net; other members = −net.
    const splits: { user_id: string; amount: number }[] = []
    for (const c of memberCols) {
      let share: number
      if (c === payerCol) share = cost - (netByCol[c] ?? 0)
      else share = -1 * (netByCol[c] ?? 0)
      if (share > 0.001) {
        splits.push({ user_id: memberUserIdByCol[c], amount: Math.round(share * 100) / 100 })
      }
    }
    if (splits.length === 0) {
      skipped.push(`${label}: could not derive any split; skipped.`)
      continue
    }

    const expenseId = state.nextExpenseId++
    state.expenses.push({
      id: expenseId,
      uuid: crypto.randomUUID(),
      group_id: groupId,
      paid_by: payerId,
      amount: Math.round(cost * 100) / 100,
      description,
      date,
      created_at: now,
      category: category || undefined,
    })
    for (const s of splits) {
      state.expenseSplits.push({ id: state.nextSplitId++, expense_id: expenseId, user_id: s.user_id, amount: s.amount })
    }
  }

  if (state.expenses.length === 0) skipped.push('No usable expense rows found.')
  return { state, skipped }
}
