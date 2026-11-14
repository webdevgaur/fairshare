import { test, expect, clearStorage, seedIdentity, seedGroup, seedExpense, gotoApp } from './setup'

test.describe('F4 — Payment Links', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('profile: save payment handles and persist across reload', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await page.locator('nav a[href="/profile"]').click()
    await page.waitForURL('**/profile')

    await expect(page.getByRole('heading', { name: 'Payment handles' })).toBeVisible()

    await page.getByPlaceholder('Venmo username').fill('alice_venmo')
    await page.getByPlaceholder('PayPal handle / email').fill('alice@paypal.com')
    await page.getByPlaceholder('Cash App cashtag (e.g. $username)').fill('$alice')

    await page.getByRole('button', { name: 'Save Handles' }).click()
    await expect(page.getByText('Saved!')).toBeVisible()

    // Reload and verify the values persisted
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.locator('nav a[href="/profile"]').click()
    await page.waitForURL('**/profile')

    await expect(page.getByPlaceholder('Venmo username')).toHaveValue('alice_venmo')
    await expect(page.getByPlaceholder('PayPal handle / email')).toHaveValue('alice@paypal.com')
    await expect(page.getByPlaceholder('Cash App cashtag (e.g. $username)')).toHaveValue('$alice')
  })

  test('group: settle form selects work and payment link opens Venmo', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Household', '', ['Bob'])
    // Alice pays $100 split equally with Bob → Bob owes $50, Alice is owed $50
    await seedExpense(page, groupId, 'Groceries', 100)

    // Give the creditor (Alice) a Venmo handle before the app loads
    await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_store')
      if (!raw) return
      const state = JSON.parse(raw)
      const alice = state.users.find((u: any) => u.name === 'Alice')
      if (alice) {
        alice.venmo_username = 'alicevenmo'
        alice.paypal_handle = 'alice@paypal.com'
        alice.cashapp_cashtag = '$alice'
      }
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    })

    await gotoApp(page, `/groups/${groupId}`)

    // Open the settle-up form
    await page.getByRole('button', { name: 'Settle Up' }).click()
    await expect(page.getByText("Who's paying?")).toBeVisible()

    // The payment button should start disabled (no recipient/amount yet)
    const payButton = page.getByRole('button', { name: 'Pay with Venmo' })
    await expect(payButton).toBeDisabled()

    // Select the payer (Bob, the debtor) and recipient (Alice, the creditor)
    await page.getByText("Who's paying?").click()
    await page.getByText('Bob owes $50.00').click()

    await page.getByText("Who's getting paid?").click()
    await page.getByText('Alice is owed $50.00').click()

    await page.getByPlaceholder('Amount').fill('50')

    // Override window.open on the loaded page to capture the URL the app opens
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orig = window.open.bind(window)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__openedUrl = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.open = (url: any, ...rest: any[]) => {
        ;(window as any).__openedUrl = String(url)
        return orig(url, ...rest)
      }
    })

    // The button should now be enabled since Alice has a Venmo handle
    await expect(payButton).toBeEnabled()
    await payButton.click()

    const openedUrl = await page.evaluate(() => (window as any).__openedUrl)
    expect(openedUrl).toBeTruthy()
    expect(openedUrl).toContain('venmo://paycharge')
    expect(openedUrl).toContain('recipients=alicevenmo')
    expect(openedUrl).toContain('amount=50.00')
    expect(openedUrl).toContain('FairShare')
  })

  test('group: suggest settlement prefills the settle form', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    const groupId = await seedGroup(page, 'Dinner', '', ['Bob'])
    await seedExpense(page, groupId, 'Pizza', 60)

    await page.evaluate(() => {
      const raw = localStorage.getItem('fairshare_store')
      if (!raw) return
      const state = JSON.parse(raw)
      const alice = state.users.find((u: any) => u.name === 'Alice')
      if (alice) {
        alice.venmo_username = 'alicevenmo'
        alice.paypal_handle = 'alice@paypal.com'
        alice.cashapp_cashtag = '$alice'
      }
      localStorage.setItem('fairshare_store', JSON.stringify(state))
    })

    await gotoApp(page, `/groups/${groupId}`)

    // Click "Suggest settlement" — single transaction should prefill & open the form
    await page.getByRole('button', { name: /Suggest settlement/ }).click()

    // The settle form should be open with the amount prefilled
    await expect(page.getByPlaceholder('Amount').first()).toBeVisible()
    await expect(page.getByPlaceholder('Amount').first()).toHaveValue('30')
    // Payment button enabled (recipient Alice has a Venmo handle)
    await expect(page.getByRole('button', { name: 'Pay with Venmo' })).toBeEnabled()
  })
})
