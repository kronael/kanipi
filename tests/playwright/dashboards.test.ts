import { test, expect } from '@playwright/test';

test.describe('Dashboard Portal', () => {
  test('portal shows dashboard list', async ({ page }) => {
    await page.goto('/dash/');
    await expect(page.locator('h1')).toHaveText('Dashboards');
    await expect(page.locator('a[href="/dash/status/"]')).toBeVisible();
    await expect(page.getByText('Status & Health')).toBeVisible();
  });

  test('portal link navigates to status', async ({ page }) => {
    await page.goto('/dash/');
    await page.click('a[href="/dash/status/"]');
    await expect(page).toHaveURL(/\/dash\/status\//);
  });

  test('unknown dashboard returns 404', async ({ page }) => {
    const res = await page.goto('/dash/nonexistent/');
    expect(res?.status()).toBe(404);
  });
});

test.describe('Status Dashboard - Shell', () => {
  test('loads shell with HTMX', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.locator('h1')).toContainText('Status');
    const htmxScript = page.locator('script[src*="htmx"]');
    await expect(htmxScript).toBeAttached();
  });

  test('back link points to portal', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.locator('a[href="/dash/"]')).toBeVisible();
  });

  test('all section headers present', async ({ page }) => {
    await page.goto('/dash/status/');
    for (const h of [
      'Gateway',
      'Channels',
      'Groups',
      'Containers',
      'Queue',
      'Tasks',
    ]) {
      await expect(page.locator(`h2:has-text("${h}")`)).toBeVisible();
    }
  });
});

test.describe('Status Dashboard - HTMX Fragments', () => {
  test('gateway fragment loads with uptime and memory', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.locator('text=Uptime')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Memory')).toBeVisible();
    await expect(page.locator('text=Max concurrent')).toBeVisible();
  });

  test('channels fragment shows channel names', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.getByText('2 channels')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('cell', { name: 'telegram', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'discord', exact: true }),
    ).toBeVisible();
  });

  test('groups fragment shows test groups', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.getByText('2 groups')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('cell', { name: 'Root', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Happy', exact: true }),
    ).toBeVisible();
  });

  test('queue fragment shows active and failure states', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.locator('th:has-text("Failures")')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('.err').first()).toBeVisible();
    await expect(page.locator('.ok').first()).toBeVisible();
  });

  test('tasks fragment shows scheduled tasks', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.getByText('0 9 * * *')).toBeVisible({ timeout: 5000 });
  });

  test('summary fragment shows chat count and timestamp', async ({ page }) => {
    await page.goto('/dash/status/');
    await expect(page.getByText('chats tracked')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Updated:')).toBeVisible();
  });

  test('hx-trigger attributes set for auto-refresh', async ({ page }) => {
    await page.goto('/dash/status/');
    const pollers = page.locator('[hx-trigger*="every 10s"]');
    const count = await pollers.count();
    expect(count).toBe(7);
  });
});

test.describe('Status API', () => {
  test('GET /dash/status/api/state returns valid JSON', async ({ request }) => {
    const res = await request.get('/dash/status/api/state');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const data = await res.json();
    expect(data).toHaveProperty('uptime_s');
    expect(data).toHaveProperty('memory_mb');
    expect(data).toHaveProperty('channels');
    expect(data).toHaveProperty('groups');
    expect(data).toHaveProperty('queue');
    expect(data).toHaveProperty('containers');
    expect(data).toHaveProperty('chats');
    expect(data).toHaveProperty('tasks');
    expect(data.channels).toHaveLength(3);
    expect(data.groups).toHaveLength(2);
  });

  test('API state reflects mock queue data', async ({ request }) => {
    const res = await request.get('/dash/status/api/state');
    const data = await res.json();
    const active = data.queue.find((q: any) => q.jid === 'telegram:-123456');
    expect(active.active).toBe(true);
    expect(active.pendingMessages).toBe(2);
    const idle = data.queue.find((q: any) => q.jid === 'telegram:789');
    expect(idle.active).toBe(false);
    expect(idle.failures).toBe(3);
  });

  test('API state reflects seeded groups', async ({ request }) => {
    const res = await request.get('/dash/status/api/state');
    const data = await res.json();
    const root = data.groups.find((g: any) => g.folder === 'root');
    expect(root.name).toBe('Root');
    expect(root.active).toBe(true);
    const happy = data.groups.find((g: any) => g.folder === 'happy');
    expect(happy.active).toBe(false);
  });
});

test.describe('Fragment Endpoints - Direct', () => {
  test('GET /x/gateway returns HTML fragment', async ({ request }) => {
    const res = await request.get('/dash/status/x/gateway');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Uptime');
    expect(html).toContain('Memory');
    expect(html).not.toContain('<!DOCTYPE');
  });

  test('GET /x/channels returns HTML fragment', async ({ request }) => {
    const res = await request.get('/dash/status/x/channels');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('telegram');
    expect(html).toContain('3 channels');
  });

  test('GET /x/groups returns HTML fragment', async ({ request }) => {
    const res = await request.get('/dash/status/x/groups');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Root');
    expect(html).toContain('2 groups');
  });

  test('GET /x/queue returns HTML fragment', async ({ request }) => {
    const res = await request.get('/dash/status/x/queue');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('telegram:-123456');
  });

  test('GET /x/containers returns HTML fragment', async ({ request }) => {
    const res = await request.get('/dash/status/x/containers');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('0 containers');
  });

  test('GET /x/tasks returns task data', async ({ request }) => {
    const res = await request.get('/dash/status/x/tasks');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('task-1');
    expect(html).toContain('0 9 * * *');
  });

  test('GET /x/summary returns timestamp', async ({ request }) => {
    const res = await request.get('/dash/status/x/summary');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Updated');
    expect(html).toContain('chats');
  });

  test('GET /x/nonexistent returns 404', async ({ request }) => {
    const res = await request.get('/dash/status/x/nonexistent');
    expect(res.status()).toBe(404);
  });
});

test.describe('Navigation Flow', () => {
  test('full flow: portal -> status -> fragments -> back', async ({ page }) => {
    await page.goto('/dash/');
    await expect(page.locator('h1')).toHaveText('Dashboards');

    await page.click('a[href="/dash/status/"]');
    await expect(page.locator('h1')).toContainText('Status');

    await expect(page.locator('text=Uptime')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('cell', { name: 'telegram', exact: true }),
    ).toBeVisible();

    await page.click('a[href="/dash/"]');
    await expect(page.locator('h1')).toHaveText('Dashboards');
  });
});
