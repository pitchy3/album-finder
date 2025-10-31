import { test, expect } from '@playwright/test';
import { setupTestUser, mockLidarrConfig, mockMusicBrainzSearch, mockLidarrLookup } from './helpers/setup';

test.describe('Lidarr Integration', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUser(page);
    await mockLidarrConfig(page);
  });

  test('should add album to Lidarr', async ({ page }) => {
    await mockMusicBrainzSearch(page, {
      recordings: [{
        id: 'rec-1',
        title: 'Test Song',
        releases: [{
          'release-group': {
            id: 'rg-1',
            title: 'Test Album',
            'primary-type': 'Album'
          }
        }]
      }]
    });

    await mockLidarrLookup(page, false);

    // Mock add to Lidarr endpoint
    await page.route('**/api/lidarr/add', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          title: 'Test Album',
          message: 'Album added successfully'
        })
      });
    });

    await page.goto('/');
    
    // Search for album
    await page.getByPlaceholderText('Track name').fill('Test Song');
    await page.getByRole('button', { name: 'Find Albums' }).click();
    
    // Add to Lidarr
    await page.getByRole('button', { name: '➕ Add to Lidarr' }).click();
    
    // Verify success notification
    await expect(page.getByText(/added successfully/i)).toBeVisible();
  });

  test('should show album already in Lidarr', async ({ page }) => {
    await mockMusicBrainzSearch(page, {
      recordings: [{
        releases: [{
          'release-group': {
            id: 'rg-1',
            title: 'Test Album'
          }
        }]
      }]
    });

    await mockLidarrLookup(page, true);

    await page.goto('/');
    
    await page.getByPlaceholderText('Track name').fill('Test Song');
    await page.getByRole('button', { name: 'Find Albums' }).click();
    
    // Should show album is already in library
    await expect(page.getByText('✅ In Lidarr (Complete)')).toBeVisible();
  });

  test('should configure Lidarr settings', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to settings
    await page.getByRole('button', { name: '⚙️' }).click();
    
    // Go to Lidarr tab
    await page.getByText('Lidarr Settings').click();
    
    // Fill in configuration
    await page.getByLabel('Lidarr URL').fill('http://lidarr:8686');
    await page.getByLabel('API Key').fill('test-api-key-12345');
    
    // Mock test connection
    await page.route('**/api/config/lidarr/test', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          version: '1.0.0',
          profiles: [{ id: 1, name: 'Standard' }]
        })
      });
    });
    
    // Test connection
    await page.getByRole('button', { name: 'Test Lidarr Connection' }).click();
    await expect(page.getByText(/Connection successful/i)).toBeVisible();
    
    // Save configuration
    await page.route('**/api/config/lidarr', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Configuration saved'
          })
        });
      } else {
        await route.continue();
      }
    });
    
    await page.getByRole('button', { name: 'Save Lidarr Configuration' }).click();
    await expect(page.getByText(/saved successfully/i)).toBeVisible();
  });
});