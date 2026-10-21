import { expect, test } from '@playwright/test'

test('AC-D5 AC-D7 production server forces simulated approval, ships strict CSP, and serves local imagery; AC-U1', async ({ page }) => {
  const documentResponse = await page.goto('/')
  expect(documentResponse).not.toBeNull()
  const contentSecurityPolicy = documentResponse!.headers()['content-security-policy']
  expect(contentSecurityPolicy).toContain("style-src 'self'")
  expect(contentSecurityPolicy).toContain("img-src 'self'")
  expect(contentSecurityPolicy).toContain("font-src 'self'")
  expect(contentSecurityPolicy).not.toContain("'unsafe-inline'")
  expect(contentSecurityPolicy).not.toContain('data:')

  await expect(page.locator('[style]')).toHaveCount(0)
  const photos = page.locator('img')
  await expect(photos).toHaveCount(14)
  const allPhotosLoaded = await photos.evaluateAll(async (images) => {
    await Promise.all(images.map(async (image) => {
      image.loading = 'eager'
      await image.decode()
    }))
    return images.every((image) => image.naturalWidth > 0)
  })
  expect(allPhotosLoaded).toBe(true)
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add Turkey melt' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await page.getByRole('button', { name: 'Continue to place order' }).click()
  await expect(page.getByRole('heading', { name: 'Place your order' })).toBeVisible()
  await expect(page.getByText(/Demo only: no payment is taken/)).toBeVisible()
  await expect(page.locator('#payment-scenario')).toHaveCount(0)
  await expect(page.locator('input')).toHaveCount(0)
  await page.getByRole('button', { name: /Place demo order/ }).click()

  await expect(page.getByRole('heading', { name: 'Order receipt' })).toBeVisible()
  await expect(page.getByText(/DEMO ONLY.*payment was simulated.*no money was charged/i)).toBeVisible()
  await expect(page.locator('.pickup-card strong')).toHaveText('1')
  await expect(page.locator('.receipt-card li')).toContainText('Turkey melt')
})
