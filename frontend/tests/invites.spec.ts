import { test, expect, clearStorage, seedIdentity, seedGroup, gotoApp } from './setup'
import type { Page } from '@playwright/test'

/**
 * F8 — Group Member Invite E2E tests.
 *
 * These drive the real application through `src/lib/api.ts` / `src/lib/invites.ts`
 * (loaded via dynamic `import()` in the Vite dev page context).
 */

/* ─── Helpers ─── */

/** Read the raw store state from localStorage (for checking side effects). */
async function readStore(page: Page): Promise<any> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('fairshare_store')
    return raw ? JSON.parse(raw) : null
  })
}

/** Get the current identity id from localStorage. */
async function getLocalUserId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('fairshare_identity')
    return raw ? (JSON.parse(raw) as { id: string }).id : ''
  })
}

/** Get the local user's name from localStorage. */
async function getLocalUserName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('fairshare_identity')
    return raw ? (JSON.parse(raw) as { name: string }).name : ''
  })
}

/** Get the Ed25519 public key hex from localStorage. */
async function getLocalPubkey(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('fairshare_ed25519_pub') ?? '')
}

/**
 * Add a user to the store singleton (in-memory + localStorage) so the store
 * is aware of them. Returns the user's id.
 */
async function seedUser(page: Page, name: string): Promise<string> {
  return page.evaluate(async (name: string) => {
    const m: any = await import('/src/lib/store.ts')
    const store = m.store
    const id = crypto.randomUUID()
    store.upsertUser(id, name)
    return id
  }, name)
}

/**
 * Call an API function by importing the module graph in-browser.
 */
async function callApi(page: Page, fnName: string, ...args: unknown[]): Promise<any> {
  return page.evaluate(
    async ({ fnName, args }: { fnName: string; args: unknown[] }) => {
      const api: any = await import('/src/lib/api.ts')
      const fn = api[fnName]
      if (typeof fn !== 'function') throw new Error('__NOT_IMPL__ ' + fnName)
      return fn.apply(api, args)
    },
    { fnName, args },
  )
}

/**
 * Call an invites.ts function by importing the module graph in-browser.
 */
async function callInviteFn(page: Page, fnName: string, ...args: unknown[]): Promise<any> {
  return page.evaluate(
    async ({ fnName, args }: { fnName: string; args: unknown[] }) => {
      const mod: any = await import('/src/lib/invites.ts')
      const fn = mod[fnName]
      if (typeof fn !== 'function') throw new Error('__NOT_IMPL__ ' + fnName)
      return fn.apply(mod, args)
    },
    { fnName, args },
  )
}

/**
 * Run an API call that may throw, returning a result object.
 */
async function tryApi(page: Page, fnName: string, ...args: unknown[]): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const data = await callApi(page, fnName, ...args)
    return { ok: true, data }
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) }
  }
}

/* ─── Tests ─── */

test.describe('F8 - Group Member Invite', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('encode and decode identity QR round-trips correctly', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    const name = await getLocalUserName(page)
    const pubkey = await getLocalPubkey(page)
    await gotoApp(page, '/')

    const encoded = await callInviteFn(page, 'encodeIdentityQR', aliceId, name, pubkey)
    expect(typeof encoded).toBe('string')

    const decoded = await callInviteFn(page, 'parseIdentityQR', encoded)
    expect(decoded).not.toBeNull()
    expect(decoded.t).toBe('identity')
    expect(decoded.id).toBe(aliceId)
    expect(decoded.name).toBe('Alice')
    expect(decoded.pubkey).toBe(pubkey)
  })

  test('creates a pending invite for a group', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    // Add Bob via the store singleton so in-memory state is consistent
    const bobId = await seedUser(page, 'Bob')

    const result = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(result.ok).toBe(true)
    const invite = result.data!
    expect(invite.status).toBe('pending')
    expect(invite.group_id).toBe(groupId)
    expect(invite.invitee_id).toBe(bobId)
    expect(typeof invite.token).toBe('string')
    expect(invite.token.length).toBeGreaterThan(0)

    // Bob is NOT a group member yet
    const membersResult = await tryApi(page, 'getGroupMembers', groupId)
    expect(membersResult.ok).toBe(true)
    const members = membersResult.data!
    const bobIsMember = members.some((m: any) => m.id === bobId)
    expect(bobIsMember).toBe(false)
  })

  test('accept invite adds member to group', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')
    await gotoApp(page, '/') // reload so singleton re-reads from localStorage

    const res1 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(res1.ok).toBe(true)
    const invite = res1.data!

    const res2 = await tryApi(page, 'acceptInvite', invite.uuid, bobId)
    expect(res2.ok).toBe(true)

    // Bob is now a member
    const membersResult = await tryApi(page, 'getGroupMembers', groupId)
    expect(membersResult.ok).toBe(true)
    const members = membersResult.data!
    const bobIsMember = members.some((m: any) => m.id === bobId)
    expect(bobIsMember).toBe(true)
    expect(members.length).toBe(2) // Alice + Bob

    // Invite status is 'accepted'
    const invResult = await tryApi(page, 'getInviteByToken', invite.token)
    expect(invResult.ok).toBe(true)
    expect(invResult.data!.status).toBe('accepted')
  })

  test('decline invite does not add member', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')

    const res1 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(res1.ok).toBe(true)
    const invite = res1.data!

    const res2 = await tryApi(page, 'declineInvite', invite.uuid)
    expect(res2.ok).toBe(true)

    // Bob is NOT a member
    const membersResult = await tryApi(page, 'getGroupMembers', groupId)
    expect(membersResult.ok).toBe(true)
    const bobIsMember = membersResult.data!.some((m: any) => m.id === bobId)
    expect(bobIsMember).toBe(false)

    // Invite status is 'declined'
    const invResult = await tryApi(page, 'getInviteByToken', invite.token)
    expect(invResult.ok).toBe(true)
    expect(invResult.data!.status).toBe('declined')
  })

  test('get invite by token works', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')

    const res1 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(res1.ok).toBe(true)
    const invite = res1.data!

    const res2 = await tryApi(page, 'getInviteByToken', invite.token)
    expect(res2.ok).toBe(true)
    const found = res2.data!
    expect(found.token).toBe(invite.token)
    expect(found.group_id).toBe(groupId)
    expect(found.invitee_id).toBe(bobId)
    expect(found.status).toBe('pending')
  })

  test('get pending invites for group returns only pending invites', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')
    const carolId = await seedUser(page, 'Carol')
    const daveId = await seedUser(page, 'Dave')

    // Bob — stays pending
    const r1 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(r1.ok).toBe(true)
    const inviteBob = r1.data!

    // Carol — will be accepted
    const r2 = await tryApi(page, 'createInviteForGroup', groupId, carolId, 'Carol')
    expect(r2.ok).toBe(true)
    await tryApi(page, 'acceptInvite', r2.data!.uuid, carolId)

    // Dave — stays pending
    const r3 = await tryApi(page, 'createInviteForGroup', groupId, daveId, 'Dave')
    expect(r3.ok).toBe(true)
    const inviteDave = r3.data!

    const resAll = await tryApi(page, 'getPendingInvitesForGroup', groupId)
    expect(resAll.ok).toBe(true)
    const allInvites = resAll.data!
    expect(allInvites.length).toBe(3)

    // Filter to pending only client-side
    const pending = allInvites.filter((i: any) => i.status === 'pending')
    expect(pending.length).toBe(2)
    const pendingTokens = pending.map((i: any) => i.token).sort()
    expect(pendingTokens).toEqual([inviteBob.token, inviteDave.token].sort())
  })

  test('get pending invites for user returns invites where user is the invitee', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const aliceId = await getLocalUserId(page)
    const bobId = await seedUser(page, 'Bob')
    const carolId = await seedUser(page, 'Carol')

    // Create invite for Bob only
    const r = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(r.ok).toBe(true)

    // Alice has no pending invites as invitee
    const aliceRes = await tryApi(page, 'getPendingInvitesForUser', aliceId)
    expect(aliceRes.ok).toBe(true)
    expect(aliceRes.data!.length).toBe(0)

    // Bob sees 1
    const bobRes = await tryApi(page, 'getPendingInvitesForUser', bobId)
    expect(bobRes.ok).toBe(true)
    expect(bobRes.data!.length).toBe(1)

    // Carol sees 0
    const carolRes = await tryApi(page, 'getPendingInvitesForUser', carolId)
    expect(carolRes.ok).toBe(true)
    expect(carolRes.data!.length).toBe(0)
  })

  test('duplicate invite returns existing record', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')

    const r1 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(r1.ok).toBe(true)
    const first = r1.data!

    const r2 = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(r2.ok).toBe(true)
    const second = r2.data!

    expect(second.token).toBe(first.token)
    expect(second.uuid).toBe(first.uuid)

    const store = await readStore(page)
    expect(store.pendingInvites.length).toBe(1)
  })

  test('build and parse invite link', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Trip', 'Summer trip', [])
    await gotoApp(page, '/')

    const bobId = await seedUser(page, 'Bob')

    const r = await tryApi(page, 'createInviteForGroup', groupId, bobId, 'Bob')
    expect(r.ok).toBe(true)
    const invite = r.data!

    const link = await callInviteFn(page, 'buildInviteLink', invite.token)
    expect(typeof link).toBe('string')
    expect(link).toContain('?invite=')
    expect(link).toContain(invite.token)

    const parsedToken = await callInviteFn(page, 'parseInviteLink', link)
    expect(parsedToken).not.toBeNull()
    expect(parsedToken).toBe(invite.token)
  })

  test('encode identity QR encodes expected fields', async ({ page }) => {
    const aliceId = await seedIdentity(page, 'Alice')
    const name = await getLocalUserName(page)
    const pubkey = await getLocalPubkey(page)
    await gotoApp(page, '/')

    const encoded = await callInviteFn(page, 'encodeIdentityQR', aliceId, name, pubkey)
    expect(typeof encoded).toBe('string')

    const parsed = JSON.parse(encoded)
    expect(parsed.t).toBe('identity')
    expect(parsed.id).toBe(aliceId)
    expect(parsed.name).toBe('Alice')
    expect(parsed.pubkey).toBe(pubkey)
  })

  test('parseIdentityQR returns null for invalid input', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page, '/')

    const r1 = await callInviteFn(page, 'parseIdentityQR', 'not-json-at-all')
    expect(r1).toBeNull()

    const r2 = await callInviteFn(page, 'parseIdentityQR', JSON.stringify({ t: 'identity', name: 'N', pubkey: 'k' }))
    expect(r2).toBeNull()

    const r3 = await callInviteFn(page, 'parseIdentityQR', JSON.stringify({ t: 'group', id: 'abc', name: 'G', pubkey: 'k' }))
    expect(r3).toBeNull()

    const r4 = await callInviteFn(page, 'parseIdentityQR', JSON.stringify({ id: 'abc', name: 'N', pubkey: 'k' }))
    expect(r4).toBeNull()

    const r5 = await callInviteFn(page, 'parseIdentityQR', 'null')
    expect(r5).toBeNull()

    const r6 = await callInviteFn(page, 'parseIdentityQR', '[]')
    expect(r6).toBeNull()
  })
})