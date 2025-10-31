import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should redirect to login when auth enabled', async ({ page }) => {
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: false,
          authEnabled: true
        })
      });
    });

    await page.goto('/');
    
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
  });

  test('should show app when authenticated', async ({ page }) => {
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          authEnabled: true,
          user: {
            sub: 'test-user',
            email: 'test@example.com',
            preferred_username: 'testuser'
          }
        })
      });
    });

    await page.goto('/');
    
    await expect(page.getByPlaceholderText('Track name')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          authEnabled: true,
          user: { sub: 'test-user' }
        })
      });
    });

    await page.route('**/auth/logout', async route => {
      await route.fulfill({
        status: 302,
        headers: { Location: '/' }
      });
    });

    await page.goto('/');
    
    // Click logout button
    await page.getByRole('button', { name: '⏏' }).click();
    
    // Should redirect to login
    await expect(page.getByText('Authentication Required')).toBeVisible();
  });
});