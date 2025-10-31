module.exports = {
  mockRecording: {
    id: 'rec-123',
    title: 'Test Song',
    'artist-credit': [{
      name: 'Test Artist',
      artist: {
        id: 'artist-123',
        name: 'Test Artist'
      }
    }],
    releases: [{
      id: 'rel-123',
      title: 'Test Album',
      'release-group': {
        id: 'rg-123',
        title: 'Test Album',
        'primary-type': 'Album',
        'first-release-date': '2024-01-01'
      }
    }]
  },

  mockReleaseGroup: {
    id: 'rg-123',
    title: 'Test Album',
    'primary-type': 'Album',
    'secondary-types': [],
    'first-release-date': '2024-01-01',
    'artist-credit': [{
      name: 'Test Artist',
      artist: {
        id: 'artist-123',
        name: 'Test Artist'
      }
    }]
  },

  mockSearchResults: {
    recordings: [
      {
        id: 'rec-1',
        title: 'Song 1',
        'artist-credit': [{ name: 'Artist 1' }]
      },
      {
        id: 'rec-2',
        title: 'Song 2',
        'artist-credit': [{ name: 'Artist 2' }]
      }
    ]
  }
};