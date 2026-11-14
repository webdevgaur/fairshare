import { test, expect, clearStorage, seedIdentity, seedGroup, gotoApp } from './setup'

test.describe('Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows empty state when no groups exist', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await expect(page.getByText('No groups yet')).toBeVisible()
    await expect(page.getByText('Create a group to start splitting expenses')).toBeVisible()
  })

  test('shows zero summary cards', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await expect(page.getByText("You're owed")).toBeVisible()
    await expect(page.getByText('You owe')).toBeVisible()
  })

  test('create group with members via UI', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await page.getByRole('button', { name: '+ New Group' }).click()

    await page.getByPlaceholder('Group name').fill('Dinner Club')
    await page.getByPlaceholder('Description (optional)').fill('Weekly dinners')
    await page.getByPlaceholder('Other members (comma-separated names)').fill('Bob, Charlie')

    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByText('Dinner Club')).toBeVisible()
    await expect(page.getByText('3 members')).toBeVisible()
  })

  test('cancel group creation closes form', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await gotoApp(page)

    await page.getByRole('button', { name: '+ New Group' }).click()
    await expect(page.getByPlaceholder('Group name')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByPlaceholder('Group name')).not.toBeVisible()
  })

  test('displays existing groups from seed data', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Trip to Paris', 'Summer vacation', ['Bob', 'Charlie'])
    await gotoApp(page)

    await expect(page.getByText('Trip to Paris')).toBeVisible()
    await expect(page.getByText('3 members')).toBeVisible()
    await expect(page.getByText('settled up')).toBeVisible()
  })

  test('clicking a group navigates to group page', async ({ page }) => {
    await seedIdentity(page, 'Alice')
    await seedGroup(page, 'Roommates', 'Apartment expenses', ['Bob'])
    await gotoApp(page)

    await page.getByText('Roommates').click()

    await expect(page.getByRole('heading', { name: 'Roommates' })).toBeVisible()
    await expect(page.getByText('No expenses yet')).toBeVisible()
  })
})