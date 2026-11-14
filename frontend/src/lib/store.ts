import type { Expense, ExpenseSplit, Settlement, Member, PaymentHandles, Comment } from './engine'

const STORAGE_KEY = 'fairshare_store'

/* ─── Internal record types ─── */

export interface UserRecord {
  id: string
  name: string
  venmo_username?: string | null
  paypal_handle?: string | null
  cashapp_cashtag?: string | null
}

export interface GroupRecord {
  id: number
  /** Globally-unique stable identifier shared across devices. */
  uuid: string
  name: string
  description: string | null
  created_at: string
}

export interface GroupMemberRecord {
  group_id: number
  user_id: string
}

export interface ExpenseRecord {
  id: number
  /** Globally-unique stable identifier shared across devices. */
  uuid: string
  group_id: number
  paid_by: string
  amount: number
  description: string
  date: string
  created_at: string
  /** Optional curated category (one of CATEGORIES); absent = "Other" at read. */
  category?: string
}

export interface ExpenseSplitRecord {
  id: number
  expense_id: number
  user_id: string
  amount: number
}

export interface SettlementRecord {
  id: number
  /** Globally-unique stable identifier shared across devices. */
  uuid: string
  group_id: number
  from_user: string
  to_user: string
  amount: number
  date: string
  created_at: string
}

export interface CommentRecord {
  id: number
  group_id: number
  expense_uuid: string
  expense_id: number
  author_id: string
  author_name: string
  text: string
  created_at: string
}

/* ─── Store state ─── */

export interface StoreState {
  users: UserRecord[]
  groups: GroupRecord[]
  groupMembers: GroupMemberRecord[]
  expenses: ExpenseRecord[]
  expenseSplits: ExpenseSplitRecord[]
  settlements: SettlementRecord[]
  comments: CommentRecord[]
  nextGroupId: number
  nextExpenseId: number
  nextSettlementId: number
  nextSplitId: number
  nextCommentId: number
}

/* ─── Public store class ─── */

export class LocalStore {
  private state: StoreState

  constructor() {
    this.state = this.load()
  }

  /* Persistence */
  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // storage full or unavailable — silently degrade
    }
  }

  private load(): StoreState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoreState
        return this.backfill(parsed)
      }
    } catch {
      // corrupted — start fresh
    }
    return this.emptyState()
  }

  /**
   * Migrate a store loaded from an older version. New expenses created before
   * F6 have no `uuid` / `created_at`; backfill them so comments can attach to
   * them and the activity feed has a sort key. Also initialise the `comments`
   * array and `nextCommentId` for stores that predate them.
   */
  private backfill(state: StoreState): StoreState {
    if (!Array.isArray(state.expenses)) state.expenses = []
    if (!Array.isArray(state.settlements)) state.settlements = []
    if (!Array.isArray(state.comments)) state.comments = []
    if (!state.nextCommentId) state.nextCommentId = 1

    for (const exp of state.expenses) {
      if (!exp.uuid) exp.uuid = crypto.randomUUID()
      if (!exp.created_at) {
        exp.created_at = exp.date ? `${exp.date}T00:00:00.000Z` : new Date().toISOString()
      }
    }
    for (const g of state.groups) {
      if (!g.uuid) g.uuid = crypto.randomUUID()
    }
    for (const s of state.settlements) {
      if (!s.uuid) s.uuid = crypto.randomUUID()
      if (!s.created_at) {
        s.created_at = s.date ? `${s.date}T00:00:00.000Z` : new Date().toISOString()
      }
    }
    return state
  }

  private emptyState(): StoreState {
    return {
      users: [],
      groups: [],
      groupMembers: [],
      expenses: [],
      expenseSplits: [],
      settlements: [],
      comments: [],
      nextGroupId: 1,
      nextExpenseId: 1,
      nextSettlementId: 1,
      nextSplitId: 1,
      nextCommentId: 1,
    }
  }

  reset() {
    this.state = this.emptyState()
    this.save()
  }

  /* ─── Users ─── */

  upsertUser(id: string, name: string): UserRecord {
    let existing = this.state.users.find((u) => u.id === id)
    if (existing) {
      // Name-only update — preserve any existing payment handles on the record
      existing.name = name
    } else {
      existing = { id, name }
      this.state.users.push(existing)
    }
    this.save()
    return existing
  }

  getUser(id: string): UserRecord | undefined {
    return this.state.users.find((u) => u.id === id)
  }

  getUsers(): UserRecord[] {
    return [...this.state.users]
  }

  /**
   * Merge payment handles into a user record, creating the record if absent.
   * Only fields explicitly provided in `handles` are written.
   */
  setUserPaymentHandles(userId: string, handles: PaymentHandles): UserRecord {
    let existing = this.state.users.find((u) => u.id === userId)
    if (!existing) {
      existing = { id: userId, name: '' }
      this.state.users.push(existing)
    }
    if (handles.venmo_username !== undefined) existing.venmo_username = handles.venmo_username
    if (handles.paypal_handle !== undefined) existing.paypal_handle = handles.paypal_handle
    if (handles.cashapp_cashtag !== undefined) existing.cashapp_cashtag = handles.cashapp_cashtag
    this.save()
    return existing
  }

  /** Return the payment handles for a user, or null if none are set. */
  getUserPaymentHandles(userId: string): PaymentHandles | null {
    const user = this.state.users.find((u) => u.id === userId)
    if (!user) return null
    const handles: PaymentHandles = {}
    if (user.venmo_username) handles.venmo_username = user.venmo_username
    if (user.paypal_handle) handles.paypal_handle = user.paypal_handle
    if (user.cashapp_cashtag) handles.cashapp_cashtag = user.cashapp_cashtag
    return Object.keys(handles).length > 0 ? handles : null
  }

  /* ─── Groups ─── */

  createGroup(
    name: string,
    description: string | null,
    memberIds: string[],
    opts?: { uuid?: string; created_at?: string },
  ): GroupRecord & { members: Member[] } {
    const id = this.state.nextGroupId++
    const uuid = opts?.uuid ?? crypto.randomUUID()
    const createdAt = opts?.created_at ?? new Date().toISOString().slice(0, 10)
    const group: GroupRecord = { id, uuid, name, description, created_at: createdAt }
    this.state.groups.push(group)

    // Add members
    for (const userId of memberIds) {
      this.state.groupMembers.push({ group_id: id, user_id: userId })
    }

    this.save()
    return { ...group, members: this.getGroupMembers(id) }
  }

  getGroup(id: number): GroupRecord | undefined {
    return this.state.groups.find((g) => g.id === id)
  }

  getGroups(): GroupRecord[] {
    return [...this.state.groups]
  }

  getUserGroupIds(userId: string): number[] {
    return this.state.groupMembers
      .filter((gm) => gm.user_id === userId)
      .map((gm) => gm.group_id)
  }

  getGroupMembers(groupId: number): Member[] {
    const userIds = this.state.groupMembers
      .filter((gm) => gm.group_id === groupId)
      .map((gm) => gm.user_id)

    return userIds
      .map((uid) => {
        const u = this.state.users.find((usr) => usr.id === uid)
        return u ? { id: u.id, name: u.name } : null
      })
      .filter((m): m is Member => m !== null)
  }

  /* ─── Expenses ─── */

  createExpense(
    groupId: number,
    paidBy: string,
    amount: number,
    description: string,
    splits: { user_id: string; amount: number }[],
    opts?: { uuid?: string; date?: string; created_at?: string; category?: string },
  ): Expense {
    const id = this.state.nextExpenseId++
    const nowIso = new Date().toISOString()
    const date = opts?.date ?? nowIso.slice(0, 10)
    const created_at = opts?.created_at ?? nowIso
    const uuid = opts?.uuid ?? crypto.randomUUID()
    const exp: ExpenseRecord = {
      id,
      uuid,
      group_id: groupId,
      paid_by: paidBy,
      amount,
      description,
      date,
      created_at,
      category: opts?.category,
    }
    this.state.expenses.push(exp)

    const paidByName = this.state.users.find((u) => u.id === paidBy)?.name || 'Unknown'

    const splitRecords: ExpenseSplitRecord[] = splits.map((s) => {
      const sid = this.state.nextSplitId++
      return { id: sid, expense_id: id, user_id: s.user_id, amount: s.amount }
    })
    this.state.expenseSplits.push(...splitRecords)

    const expenseSplits: ExpenseSplit[] = splitRecords.map((sr) => ({
      user_id: sr.user_id,
      user_name: this.state.users.find((u) => u.id === sr.user_id)?.name || 'Unknown',
      amount: sr.amount,
    }))

    this.save()

    return {
      id,
      uuid,
      group_id: groupId,
      paid_by: paidBy,
      paid_by_name: paidByName,
      amount,
      description,
      date,
      created_at,
      category: opts?.category,
      splits: expenseSplits,
    }
  }

  getGroupExpenses(groupId: number): Expense[] {
    const exps = this.state.expenses.filter((e) => e.group_id === groupId)
    return exps.map((e) => {
      const paidByName = this.state.users.find((u) => u.id === e.paid_by)?.name || 'Unknown'
      const splits = this.state.expenseSplits
        .filter((s) => s.expense_id === e.id)
        .map((s) => ({
          user_id: s.user_id,
          user_name: this.state.users.find((u) => u.id === s.user_id)?.name || 'Unknown',
          amount: s.amount,
        }))
      return { ...e, paid_by_name: paidByName, splits }
    })
  }

  /* ─── Settlements ─── */

  createSettlement(
    groupId: number,
    fromUser: string,
    toUser: string,
    amount: number,
    opts?: { date?: string; created_at?: string; uuid?: string },
  ): Settlement & { uuid: string } {
    const id = this.state.nextSettlementId++
    const nowIso = new Date().toISOString()
    const date = opts?.date ?? nowIso.slice(0, 10)
    const created_at = opts?.created_at ?? nowIso
    const uuid = opts?.uuid ?? crypto.randomUUID()
    const record: SettlementRecord = {
      id,
      uuid,
      group_id: groupId,
      from_user: fromUser,
      to_user: toUser,
      amount,
      date,
      created_at,
    }
    this.state.settlements.push(record)

    const fromName = this.state.users.find((u) => u.id === fromUser)?.name || 'Unknown'
    const toName = this.state.users.find((u) => u.id === toUser)?.name || 'Unknown'

    this.save()

    return {
      id,
      uuid,
      group_id: groupId,
      from_user: fromUser,
      from_user_name: fromName,
      to_user: toUser,
      to_user_name: toName,
      amount,
      date,
      created_at,
    }
  }

  getGroupSettlements(groupId: number): Settlement[] {
    return this.state.settlements
      .filter((s) => s.group_id === groupId)
      .map((s) => {
        const fromName = this.state.users.find((u) => u.id === s.from_user)?.name || 'Unknown'
        const toName = this.state.users.find((u) => u.id === s.to_user)?.name || 'Unknown'
        return { ...s, from_user_name: fromName, to_user_name: toName }
      })
  }

  /* ─── Comments ─── */

  createComment(
    groupId: number,
    expenseUuid: string,
    expenseId: number,
    authorId: string,
    authorName: string,
    text: string,
  ): Comment {
    const id = this.state.nextCommentId++
    const nowIso = new Date().toISOString()
    const record: CommentRecord = {
      id,
      group_id: groupId,
      expense_uuid: expenseUuid,
      expense_id: expenseId,
      author_id: authorId,
      author_name: authorName,
      text,
      created_at: nowIso,
    }
    this.state.comments.push(record)
    this.save()
    return { ...record }
  }

  getExpenseComments(expenseUuid: string): Comment[] {
    return this.state.comments
      .filter((c) => c.expense_uuid === expenseUuid)
      .map((c) => ({ ...c }))
  }

  getGroupComments(groupId: number): Comment[] {
    return this.state.comments
      .filter((c) => c.group_id === groupId)
      .map((c) => ({ ...c }))
  }

  /* ─── Raw data export for sync ─── */

  getAllData(): StoreState {
    return JSON.parse(JSON.stringify(this.state))
  }

  /* ─── Export / Import ─── */

  /**
   * Replace the entire store with the given state (deep copy), fix foreign
   * keys and re-derive id counters. Used by the "Replace all data" restore
   * mode.
   */
  restoreState(data: StoreState): void {
    this.state = this.normalizeImport(data)
    this.save()
  }

  /**
   * Import exported data.
   *  - mode 'replace': wipe and apply `imported` verbatim.
   *  - mode 'merge' (default): upsert entities by `uuid`, append unmatched
   *    entities with a fresh numeric id, and re-point child rows to the new
   *    ids using `uuid` as the join key. Idempotent — no duplicate creation.
   * Numeric ids are regenerated (never trusted from the file) and the
   * `next*Id` counters are recomputed.
   */
  importStoreState(imported: StoreState, mode: 'merge' | 'replace' = 'merge'): void {
    this.ensureUuids(imported)
    this.state = mode === 'replace' ? this.normalizeImport(imported) : this.mergeState(imported)
    this.save()
  }

  /** Backfill a uuid for any group/expense/settlement record missing one. */
  private ensureUuids(state: StoreState): void {
    for (const g of state.groups) if (!g.uuid) g.uuid = crypto.randomUUID()
    for (const e of state.expenses) if (!e.uuid) e.uuid = crypto.randomUUID()
    for (const s of state.settlements) if (!s.uuid) s.uuid = crypto.randomUUID()
  }

  /**
   * Deep-copy logic shared by restore and merge: ensure every entity array is
   * present, re-derive the denormalised `comments.expense_id` from the stable
   * `expense_uuid`, and recompute the `next*Id` counters from the data.
   */
  private normalizeImport(data: StoreState): StoreState {
    const next = JSON.parse(JSON.stringify(data)) as StoreState
    next.users = Array.isArray(next.users) ? next.users : []
    next.groups = Array.isArray(next.groups) ? next.groups : []
    next.groupMembers = Array.isArray(next.groupMembers) ? next.groupMembers : []
    next.expenses = Array.isArray(next.expenses) ? next.expenses : []
    next.expenseSplits = Array.isArray(next.expenseSplits) ? next.expenseSplits : []
    next.settlements = Array.isArray(next.settlements) ? next.settlements : []
    next.comments = Array.isArray(next.comments) ? next.comments : []
    this.ensureUuids(next)
    this.fixCommentExpenseIds(next)
    return this.recomputeCounters(next)
  }

  /** Re-derive `comments.expense_id` from the stable `expense_uuid`. */
  private fixCommentExpenseIds(state: StoreState): void {
    const idByUuid = new Map<string, number>()
    for (const e of state.expenses) idByUuid.set(e.uuid, e.id)
    for (const c of state.comments) {
      c.expense_id = idByUuid.get(c.expense_uuid) ?? -1
    }
  }

  /** Recompute the `next*Id` counters as max(id) + 1 to avoid collisions. */
  private recomputeCounters(state: StoreState): StoreState {
    state.nextGroupId = maxId(state.groups) + 1
    state.nextExpenseId = maxId(state.expenses) + 1
    state.nextSettlementId = maxId(state.settlements) + 1
    state.nextSplitId = maxId(state.expenseSplits) + 1
    state.nextCommentId = maxId(state.comments) + 1
    return state
  }

  /**
   * Merge `imported` into the current state by uuid. FKs (expenseSplits
   * .expense_id, groupMembers.group_id, settlements.group_id and comments'
   * expense_id/group_id) are re-pointed to the merged numeric ids using uuid
   * as the join key. No duplicates are created on re-import.
   */
  private mergeState(imported: StoreState): StoreState {
    const cur = this.state
    const nextUsers: UserRecord[] = [...cur.users]
    const nextGroups: GroupRecord[] = [...cur.groups]
    const nextGroupMembers: GroupMemberRecord[] = [...cur.groupMembers]
    const nextExpenses: ExpenseRecord[] = [...cur.expenses]
    const nextSplits: ExpenseSplitRecord[] = [...cur.expenseSplits]
    const nextSettlements: SettlementRecord[] = [...cur.settlements]
    const nextComments: CommentRecord[] = [...cur.comments]

    // Maps from the *imported* numeric id to the imported uuid (join keys)
    const importedGroupIdToUuid = new Map<number, string>()
    for (const g of imported.groups) importedGroupIdToUuid.set(g.id, g.uuid)
    const importedExpenseIdToUuid = new Map<number, string>()
    for (const e of imported.expenses) importedExpenseIdToUuid.set(e.id, e.uuid)

    // Resolved uuid → numeric id within the merged state
    const groupUuidToId = new Map<string, number>()
    for (const g of nextGroups) groupUuidToId.set(g.uuid, g.id)
    const expenseUuidToId = new Map<string, number>()
    for (const e of nextExpenses) expenseUuidToId.set(e.uuid, e.id)

    // Users: upsert by stable string id
    for (const iu of imported.users) {
      const existing = nextUsers.find((u) => u.id === iu.id)
      if (existing) {
        existing.name = iu.name
        if (iu.venmo_username !== undefined) existing.venmo_username = iu.venmo_username
        if (iu.paypal_handle !== undefined) existing.paypal_handle = iu.paypal_handle
        if (iu.cashapp_cashtag !== undefined) existing.cashapp_cashtag = iu.cashapp_cashtag
      } else {
        nextUsers.push({ ...iu })
      }
    }

    // Groups: upsert by uuid
    for (const ig of imported.groups) {
      const existing = nextGroups.find((g) => g.uuid === ig.uuid)
      if (existing) {
        existing.name = ig.name
        existing.description = ig.description
        existing.created_at = ig.created_at
      } else {
        const id = nextIdFrom(nextGroups)
        nextGroups.push({ id, uuid: ig.uuid, name: ig.name, description: ig.description, created_at: ig.created_at })
        groupUuidToId.set(ig.uuid, id)
      }
    }

    // Group members: remap group_id via uuid (append missing members)
    for (const gm of imported.groupMembers) {
      const igUuid = importedGroupIdToUuid.get(gm.group_id)
      if (!igUuid) continue
      const resolvedGroupId = groupUuidToId.get(igUuid)
      if (resolvedGroupId === undefined) continue
      if (nextGroupMembers.some((x) => x.group_id === resolvedGroupId && x.user_id === gm.user_id)) continue
      nextGroupMembers.push({ group_id: resolvedGroupId, user_id: gm.user_id })
    }

    // Expenses: upsert by uuid, remap group_id via uuid
    for (const ie of imported.expenses) {
      const igUuid = importedGroupIdToUuid.get(ie.group_id)
      const resolvedGroupId = igUuid ? groupUuidToId.get(igUuid) : undefined
      const existing = nextExpenses.find((e) => e.uuid === ie.uuid)
      if (existing) {
        if (resolvedGroupId !== undefined) existing.group_id = resolvedGroupId
        existing.paid_by = ie.paid_by
        existing.amount = ie.amount
        existing.description = ie.description
        existing.date = ie.date
        existing.created_at = ie.created_at
        if (ie.category !== undefined) existing.category = ie.category
      } else {
        const id = nextIdFrom(nextExpenses)
        nextExpenses.push({
          id,
          uuid: ie.uuid,
          group_id: resolvedGroupId ?? ie.group_id,
          paid_by: ie.paid_by,
          amount: ie.amount,
          description: ie.description,
          date: ie.date,
          created_at: ie.created_at,
          category: ie.category,
        })
        expenseUuidToId.set(ie.uuid, id)
      }
    }

    // Expense splits: remap expense_id via uuid (append missing splits)
    for (const s of imported.expenseSplits) {
      const ieUuid = importedExpenseIdToUuid.get(s.expense_id)
      if (!ieUuid) continue
      const resolvedExpenseId = expenseUuidToId.get(ieUuid)
      if (resolvedExpenseId === undefined) continue
      if (nextSplits.some((x) => x.expense_id === resolvedExpenseId && x.user_id === s.user_id && x.amount === s.amount)) continue
      nextSplits.push({ id: nextIdFrom(nextSplits), expense_id: resolvedExpenseId, user_id: s.user_id, amount: s.amount })
    }

    // Settlements: upsert by uuid, remap group_id via uuid
    for (const is of imported.settlements) {
      const igUuid = importedGroupIdToUuid.get(is.group_id)
      const resolvedGroupId = igUuid ? groupUuidToId.get(igUuid) : undefined
      const existing = nextSettlements.find((s) => s.uuid === is.uuid)
      if (existing) {
        if (resolvedGroupId !== undefined) existing.group_id = resolvedGroupId
        existing.from_user = is.from_user
        existing.to_user = is.to_user
        existing.amount = is.amount
        existing.date = is.date
        existing.created_at = is.created_at
      } else {
        nextSettlements.push({
          id: nextIdFrom(nextSettlements),
          uuid: is.uuid,
          group_id: resolvedGroupId ?? is.group_id,
          from_user: is.from_user,
          to_user: is.to_user,
          amount: is.amount,
          date: is.date,
          created_at: is.created_at,
        })
      }
    }

    // Comments: dedupe on stable (expense_uuid + author + text + created_at);
    // re-derive expense_id from expense_uuid and remap group_id via uuid.
    for (const ic of imported.comments) {
      const igUuid = importedGroupIdToUuid.get(ic.group_id)
      const resolvedGroupId = igUuid ? groupUuidToId.get(igUuid) : undefined
      const resolvedExpenseId = expenseUuidToId.get(ic.expense_uuid) ?? -1
      const dup = nextComments.some(
        (c) => c.expense_uuid === ic.expense_uuid && c.author_id === ic.author_id && c.text === ic.text && c.created_at === ic.created_at,
      )
      if (dup) continue
      nextComments.push({
        id: nextIdFrom(nextComments),
        group_id: resolvedGroupId ?? ic.group_id,
        expense_uuid: ic.expense_uuid,
        expense_id: resolvedExpenseId,
        author_id: ic.author_id,
        author_name: ic.author_name,
        text: ic.text,
        created_at: ic.created_at,
      })
    }

    return this.recomputeCounters({
      users: nextUsers,
      groups: nextGroups,
      groupMembers: nextGroupMembers,
      expenses: nextExpenses,
      expenseSplits: nextSplits,
      settlements: nextSettlements,
      comments: nextComments,
      nextGroupId: 1,
      nextExpenseId: 1,
      nextSettlementId: 1,
      nextSplitId: 1,
      nextCommentId: 1,
    })
  }
}

/** max(id) across a list of records that carry a numeric `id`. */
function maxId(records: { id: number }[]): number {
  let m = 0
  for (const r of records) if (r.id > m) m = r.id
  return m
}

/** The next free numeric id for a collection (max + 1). */
function nextIdFrom(records: { id: number }[]): number {
  return maxId(records) + 1
}

/** Singleton store instance shared across the app */
export const store = new LocalStore()