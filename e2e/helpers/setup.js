export async function setupTestUser(page) {
  // Mock authentication
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
}

export async function mockLidarrConfig(page) {
  await page.route('**/api/config/lidarr', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: 'http://lidarr:8686',
        apiKey: '***1234',
        rootFolder: '/music',
        qualityProfileId: 1
      })
    });
  });
}

export async function mockMusicBrainzSearch(page, results = []) {
  await page.route('**/api/musicbrainz/**', async route => {
    const url = route.request().url();
    
    if (url.includes('/recording')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          recordings: results.recordings || []
        })
      });
    } else if (url.includes('/release-group')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          'release-groups': results.releaseGroups || []
        })
      });
    } else {
      await route.continue();
    }
  });
}

export async function mockLidarrLookup(page, inLidarr = false) {
  await page.route('**/api/lidarr/lookup**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 1,
        title: 'Test Album',
        foreignAlbumId: 'mbid-123',
        inLibrary: inLidarr,
        fullyAvailable: inLidarr,
        percentComplete: inLidarr ? 100 : 0
      }])
    });
  });
}