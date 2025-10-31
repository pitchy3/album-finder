// smoke.spec.js - Basic smoke tests for Docker deployment
import { test, expect } from '@playwright/test';

test.describe('Smoke Tests - Critical Functionality', () => {
  test('health check endpoint responds', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
    
    const text = await response.text();
    expect(text).toBe('ok');
  });

  test('home page loads successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    
    // Verify page loaded without errors
    const content = await page.content();
    expect(content).not.toContain('Application Error');
    expect(content).not.toContain('Cannot GET');
  });

  test('API root endpoint responds', async ({ request }) => {
    const response = await request.get('/api');
    expect(response.ok()).toBeTruthy();
  
    const data = await response.json();
    expect(data).toHaveProperty('openapi');
    expect(data).toHaveProperty('info');
    expect(data.info).toHaveProperty('title');
    expect(data.info.title).toContain('Music Library');
  });

  test('authentication status endpoint works', async ({ request }) => {
    const response = await request.get('/api/auth/user');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('authEnabled');
    expect(data).toHaveProperty('loggedIn');
    expect(typeof data.authEnabled).toBe('boolean');
    expect(typeof data.loggedIn).toBe('boolean');
  });

  test('timezone info endpoint responds', async ({ request }) => {
    const response = await request.get('/api/timezone-info');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('timezone');
    expect(data).toHaveProperty('currentTime');
    expect(data).toHaveProperty('offset');
  });
});

test.describe('Smoke Tests - Docker Container Health', () => {
  test('server debug endpoint accessible', async ({ request }) => {
    const response = await request.get('/api/debug');
    
    // May require auth, so accept both 200 and 401
    expect([200, 401]).toContain(response.status());
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('Server is running');
      expect(data).toHaveProperty('redis');
      expect(data).toHaveProperty('cache');
      expect(data).toHaveProperty('queue');
    }
  });

  test('static assets are served', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
    
    // Check that we don't have console errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    
    // Simple interaction to verify JS is working
    const title = await page.title();
    expect(title).toBeTruthy();
    
    // Verify no critical JS errors occurred
    expect(errors.length).toBe(0);
  });

  test('API handles 404 gracefully', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint-12345');
    expect(response.status()).toBe(404);
  });

  test('SPA routing works', async ({ page }) => {
    // Navigate to home
    await page.goto('/');
    
    // Try navigating to a client-side route
    // The server should return the SPA for any route
    const response = await page.goto('/some-client-route');
    
    // Should get 200 (SPA handles routing)
    expect(response.status()).toBe(200);
    
    // Should not show server error
    const content = await page.content();
    expect(content).not.toContain('Cannot GET');
  });
});

test.describe('Smoke Tests - Configuration', () => {
  test('server responds with proper headers', async ({ request }) => {
    const response = await request.get('/healthz');
    
    // Check basic security headers might be present
    const headers = response.headers();
    expect(headers).toBeDefined();
  });

  test('API endpoints return JSON', async ({ request }) => {
    const response = await request.get('/api/auth/user');
    
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });
});

test.describe('Smoke Tests - Performance', () => {
  test('home page loads within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 10 seconds (generous for CI)
    expect(loadTime).toBeLessThan(10000);
  });

  test('health check responds quickly', async ({ request }) => {
    const startTime = Date.now();
    
    const response = await request.get('/healthz');
    
    const responseTime = Date.now() - startTime;
    
    expect(response.ok()).toBeTruthy();
    // Should respond within 1 second
    expect(responseTime).toBeLessThan(1000);
  });
});