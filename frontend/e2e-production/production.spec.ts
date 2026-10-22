import { expect, test } from '@playwright/test'

const expectedMenuPhotos = {
  'Turkey melt': '/images/menu/turkey-melt.jpg',
  'Garden wrap': '/images/menu/garden-wrap.jpg',
  'Chicken club': '/images/menu/chicken-club.jpg',
  'Tomato panini': '/images/menu/tomato-panini.jpg',
  'Green grain bowl': '/images/menu/grain-bowl.jpg',
  'Chicken harvest bowl': '/images/menu/chicken-bowl.jpg',
  'Falafel bowl': '/images/menu/falafel-bowl.jpg',
  'Soup of the day': '/images/menu/soup-cup.jpg',
  'Sparkling water': '/images/menu/sparkling-water.jpg',
  'House iced tea': '/images/menu/iced-tea.jpg',
  'Cold brew': '/images/menu/cold-brew.jpg',
  'Fresh lemonade': '/images/menu/lemonade.jpg',
}

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
  const brandLink = page.getByRole('link', { name: 'Good Table — Fresh food, good vibes' })
  const brandMark = brandLink.locator('img')
  await expect(brandMark).toHaveAttribute('src', '/goodtable-mark.png')
  await expect(brandMark).toHaveAttribute('alt', '')
  await expect(page.locator('.welcome-photo')).toHaveAttribute('src', '/images/hero-grain-bowl.jpg')
  const menuPhotos = page.locator('.menu-card .food-art img')
  await expect(menuPhotos).toHaveCount(12)
  const renderedMenuPhotos = await menuPhotos.evaluateAll((images) => Object.fromEntries(images.map((image) => {
    const itemName = image.closest('.menu-card')?.querySelector('h3')?.textContent?.trim() ?? ''
    return [itemName, new URL(image.src).pathname]
  })))
  expect(renderedMenuPhotos).toEqual(expectedMenuPhotos)
  const photos = page.locator('img')
  const allPhotosLoaded = await photos.evaluateAll(async (images) => {
    await Promise.all(images.map(async (image) => {
      image.loading = 'eager'
      await image.decode()
    }))
    return images.every((image) => image.naturalWidth > 0)
  })
  expect(allPhotosLoaded).toBe(true)
  const iconLinks = [
    ['image/svg+xml', '/favicon.svg'],
    ['image/png', '/favicon.png'],
  ] as const
  for (const [type, path] of iconLinks) {
    const iconLink = page.locator(`link[rel="icon"][type="${type}"]`)
    await expect(iconLink).toHaveAttribute('href', path)
    const iconResponse = await page.request.get(new URL(path, page.url()).href)
    expect(iconResponse.ok()).toBe(true)
    expect(iconResponse.headers()['content-type']).toContain(type === 'image/svg+xml' ? 'image/svg+xml' : 'image/png')
  }
  const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(appleTouchIcon).toHaveAttribute('href', '/apple-touch-icon.png')
  const appleTouchResponse = await page.request.get(new URL('/apple-touch-icon.png', page.url()).href)
  expect(appleTouchResponse.ok()).toBe(true)
  expect(appleTouchResponse.headers()['content-type']).toContain('image/png')

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

test('AC-D8 Production build keeps Development admin controls unavailable', async ({ page }) => {
  const adminRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/admin')) adminRequests.push(request.url())
  })

  const response = await page.goto('/admin')

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Admin controls are unavailable' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toHaveAttribute('href', '/')
  await expect(page.getByLabel('Development admin token')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reset demo data' })).toHaveCount(0)
  expect(adminRequests).toEqual([])

  const appScriptUrls = await page.locator('script[src]').evaluateAll((scripts) =>
    scripts.map((script) => new URL((script as HTMLScriptElement).src).href))
  const productionScripts = await Promise.all(appScriptUrls.map(async (url) => (await page.request.get(url)).text()))
  const productionBundle = productionScripts.join('\n')
  expect(productionBundle).not.toContain('/api/admin')
  expect(productionBundle).not.toContain('Reset demo data')
})

test('SC-G5 production host rejects oversized requests before JSON processing', async ({ page }) => {
  await page.goto('/')
  const response = await page.request.post(new URL('/api/quotes', page.url()).href, {
    data: 'x'.repeat(16_385),
    headers: { 'Content-Type': 'application/json' },
  })

  expect(response.status()).toBe(413)
})
