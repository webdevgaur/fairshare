import { test, expect, clearStorage, seedIdentity, seedGroup, gotoApp } from './setup'

test.describe('Sync Status Indicator', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows sync indicator in nav bar', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // Without a relay server, status is 'offline'
    await expect(page.getByTitle('Offline')).toBeVisible()
  })

  test('sync status shows "offline" without relay', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // The sync client initializes as 'offline' when no WebSocket relay is running
    await expect(page.getByTitle('Offline')).toBeVisible()
    // The text label (hidden on mobile) should show "offline"
    await expect(page.getByText('offline').first()).toBeVisible()
  })

  test('sync status shows in nav after creating a group', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // Create a group, which enqueues a sync operation
    await page.getByRole('button', { name: '+ New Group' }).click()
    await page.getByPlaceholder('Group name').fill('Sync Test Group')
    await page.getByRole('button', { name: 'Create' }).click()

    // Sync indicator should still be visible (either offline or queued)
    const offlineDot = page.getByTitle('Offline')
    const queuedDot = page.getByTitle('Changes queued')
    await expect(offlineDot.or(queuedDot)).toBeVisible()
  })
})