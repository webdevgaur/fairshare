import { test, expect, clearStorage, seedIdentity, seedGroup, gotoApp } from './setup'

test.describe('Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('nav shows FairShare logo and user initial', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await expect(page.getByText('FairShare').first()).toBeVisible()
    // User avatar initial should be in the nav (exact match)
    await expect(page.locator('nav span:has-text("A")').first()).toBeVisible()
  })

  test('profile link navigates to profile page', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    // Click the user avatar link in nav
    await page.locator('nav a[href="/profile"]').click()

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByText('Device Fingerprint')).toBeVisible()
  })

  test('back button on group page returns to dashboard', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Test Group', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    // Click back button (aria-label)
    await page.getByLabel('Back to dashboard').click()

    // Should be on dashboard
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
    await expect(page.getByText('Test Group')).toBeVisible()
  })

  test('dashboard link in nav returns home', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Nav Test', '', ['Bob'])
    await gotoApp(page, `/groups/${groupId}`)

    // Click FairShare logo in nav
    await page.locator('nav').getByText('FairShare').click()

    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
  })

  test('unknown route redirects to dashboard', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page, '/nonexistent')

    // Should redirect to dashboard — use the heading to be specific
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
  })

  test('responsive: small viewport still shows key elements', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Mobile Group', '', ['Bob'])
    await gotoApp(page)

    // Set small viewport
    await page.setViewportSize({ width: 375, height: 812 })

    // Key elements should still be visible
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()
    await expect(page.getByText('Mobile Group')).toBeVisible()
    await expect(page.getByText("You're owed")).toBeVisible()
    await expect(page.getByText('You owe')).toBeVisible()
  })
})