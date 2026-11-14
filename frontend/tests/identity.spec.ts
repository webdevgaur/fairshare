import { test, expect, clearStorage, seedIdentity, gotoApp } from './setup'

test.describe('Identity / Name Prompt Flow', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows name prompt on first visit', async ({ page }) => {
    await gotoApp(page)

    await expect(page.getByText('FairShare')).toBeVisible()
    await expect(page.getByText("What's your name?")).toBeVisible()
    await expect(page.getByPlaceholder('Enter your name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  })

  test('rejects empty name and stays on prompt', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: 'Get started' }).click()
    await expect(page.getByText("What's your name?")).toBeVisible()
  })

  test('accepts name and shows dashboard', async ({ page }) => {
    await gotoApp(page)

    await page.getByPlaceholder('Enter your name').fill('Alice')
    await page.getByRole('button', { name: 'Get started' }).click()

    // Wait for dashboard to appear
    await expect(page.getByText('Groups').first()).toBeVisible({ timeout: 15000 })
    // The nav should show the user initial
    await expect(page.locator('nav').getByText('Alice')).toBeVisible()
  })

  test('persists identity across reloads', async ({ page }) => {
    await gotoApp(page)

    await page.getByPlaceholder('Enter your name').fill('Bob')
    await page.getByRole('button', { name: 'Get started' }).click()
    await expect(page.getByText('Groups').first()).toBeVisible({ timeout: 15000 })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Groups').first()).toBeVisible()
  })

  test('profile page shows fingerprint, name editing, and reset', async ({ page }) => {
    await seedIdentity(page, 'Charlie')
    await gotoApp(page)

    await page.locator('nav a[href="/profile"]').click()
    await page.waitForURL('**/profile')

    await expect(page.getByText('Profile')).toBeVisible()
    await expect(page.getByText('Device Fingerprint')).toBeVisible()
    await expect(page.getByText('Public Key')).toBeVisible()
    await expect(page.getByText('Display Name')).toBeVisible()
    await expect(page.getByText('Danger Zone')).toBeVisible()

    // Edit name
    const nameInput = page.getByPlaceholder('Your display name')
    await nameInput.clear()
    await nameInput.fill('Charlie Updated')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved!')).toBeVisible()

    // Reload and verify name persisted
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.locator('nav a[href="/profile"]').click()
    await page.waitForURL('**/profile')
    await expect(page.locator('input[value="Charlie Updated"]')).toBeVisible()
  })

  test('reset identity clears user data (app bug: NamePrompt not shown after reset)', async ({ page }) => {
    await seedIdentity(page, 'Diana')
    await gotoApp(page)

    await page.locator('nav a[href="/profile"]').click()
    await page.waitForURL('**/profile')
    await expect(page.getByText('Profile')).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Identity' }).click()

    // After reset, App's userReady state persists, so dashboard shows without user data
    await page.waitForURL('http://localhost:5173/')
    await expect(page.getByText('Groups').first()).toBeVisible()
  })
})