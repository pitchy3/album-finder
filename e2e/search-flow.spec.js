import { test, expect } from '@playwright/test';
import { setupTestUser, mockLidarrConfig, mockMusicBrainzSearch } from './helpers/setup';

test.describe('Album Search Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUser(page);
    await mockLidarrConfig(page);
  });

  test('should search for albums by song', async ({ page }) => {
    await mockMusicBrainzSearch(page, {
      recordings: [{
        id: 'rec-1',
        title: 'Bohemian Rhapsody',
        releases: [{
          id: 'rel-1',
          'release-group': {
            id: 'rg-1',
            title: 'A Night at the Opera',
            'primary-type': 'Album'
          }
        }]
      }]
    });

    await page.goto('/');
    
    // Verify search form is visible
    await expect(page.getByPlaceholderText('Track name')).toBeVisible();
    
    // Fill in search form
    await page.getByPlaceholderText('Track name').fill('Bohemian Rhapsody');
    await page.getByPlaceholderText('Artist name').fill('Queen');
    
    // Submit search
    await page.getByRole('button', { name: 'Find Albums' }).click();
    
    // Wait for results
    await expect(page.getByText('A Night at the Opera')).toBeVisible();
    await expect(page.getByText('Queen')).toBeVisible();
  });

  test('should browse artist discography', async ({ page }) => {
    await mockMusicBrainzSearch(page, {
      releaseGroups: [
        {
          id: 'rg-1',
          title: 'Abbey Road',
          'primary-type': 'Album',
          'first-release-date': '1969-09-26'
        },
        {
          id: 'rg-2',
          title: 'Let It Be',
          'primary-type': 'Album',
          'first-release-date': '1970-05-08'
        }
      ]
    });

    await page.goto('/');
    
    // Switch to artist browse mode
    await page.getByText('🎤 Browse Artist').click();
    
    // Search for artist
    await page.getByPlaceholderText('Artist name').fill('The Beatles');
    await page.getByRole('button', { name: 'Browse Artist Releases' }).click();
    
    // Verify results
    await expect(page.getByText('Abbey Road')).toBeVisible();
    await expect(page.getByText('Let It Be')).toBeVisible();
  });

  test('should filter releases by category', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to settings
    await page.getByRole('button', { name: '⚙️' }).click();
    
    // Go to preferences tab
    await page.getByText('Preferences').click();
    
    // Uncheck singles
    await page.getByLabel('🎤 Singles').uncheck();
    
    // Go back to search
    await page.getByRole('button', { name: '🔍' }).click();
    
    // Search should now exclude singles
    await page.getByText('🎤 Browse Artist').click();
    await page.getByPlaceholderText('Artist name').fill('Test Artist');
    await page.getByRole('button', { name: 'Browse Artist Releases' }).click();
    
    // Singles should not appear
    await expect(page.getByText('SINGLE')).not.toBeVisible();
  });

  test('should show error for no results', async ({ page }) => {
    await mockMusicBrainzSearch(page, {
      recordings: []
    });

    await page.goto('/');
    
    await page.getByPlaceholderText('Track name').fill('Nonexistent Song');
    await page.getByPlaceholderText('Artist name').fill('Fake Artist');
    await page.getByRole('button', { name: 'Find Albums' }).click();
    
    await expect(page.getByText(/No matching/i)).toBeVisible();
  });
});