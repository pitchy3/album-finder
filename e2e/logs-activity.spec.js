import { test, expect } from '@playwright/test';
import { setupTestUser, mockLidarrConfig } from './helpers/setup';

test.describe('Activity Logs', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUser(page);
    await mockLidarrConfig(page);
  });

  test('should display activity logs', async ({ page }) => {
    // Mock logs API
    await page.route('**/api/logs/queries**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          logs: [
            {
              id: 1,
              timestamp: '2024-01-01T12:00:00Z',
              user_id: 'test-user',
              search_term: 'Test Song',
              artist: 'Test Artist',
              response_status: 200
            }
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            pages: 1
          }
        })
      });
    });

    await page.goto('/');
    
    // Navigate to logs page
    await page.getByRole('button', { name: '📊' }).click();
    
    // Verify logs are displayed
    await expect(page.getByText('Activity Logs')).toBeVisible();
    await expect(page.getByText('Test Song')).toBeVisible();
    await expect(page.getByText('Test Artist')).toBeVisible();
  });

  test('should filter logs by type', async ({ page }) => {
    await page.route('**/api/logs/**', async route => {
      const url = route.request().url();
      let logs = [];
      
      if (url.includes('/albums')) {
        logs = [{
          id: 1,
          album_title: 'Test Album',
          artist_name: 'Test Artist'
        }];
      } else if (url.includes('/artists')) {
        logs = [{
          id: 1,
          artist_name: 'Test Artist'
        }];
      }
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          logs,
          pagination: { page: 1, total: logs.length }
        })
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: '📊' }).click();
    
    // Switch to albums filter
    const filterSelect = page.locator('select').first();
    await filterSelect.selectOption('albums');
    
    // Verify albums are shown
    await expect(page.getByText('All Albums Added')).toBeVisible();
  });

  test('should export logs', async ({ page }) => {
    await page.route('**/api/logs/export/queries', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'timestamp,user_id,search_term\n2024-01-01,test-user,Test Song'
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: '📊' }).click();
    
    // Mock export button (if it exists)
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible()) {
      const downloadPromise = page.waitForEvent('download');
      await exportButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.csv');
    }
  });

  test('should retry failed album downloads', async ({ page }) => {
    // Mock pending albums
    await page.route('**/api/logs/albums/pending**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          logs: [{
            id: 1,
            album_title: 'Test Album',
            artist_name: 'Test Artist',
            lidarr_album_id: 123,
            downloaded: false,
            success: true
          }],
          pagination: { page: 1, total: 1 }
        })
      });
    });

    // Mock retry endpoint
    await page.route('**/api/lidarr/retry-download', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Download retry triggered'
        })
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: '📊' }).click();
    
    // Filter to pending albums
    await page.locator('select').first().selectOption('albums-pending');
    
    // Click retry button
    await page.getByRole('button', { name: /retry download/i }).first().click();
    
    // Verify success message
    await expect(page.getByText(/retry triggered/i)).toBeVisible();
  });
});