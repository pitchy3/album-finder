module.exports = {
  mockArtist: {
    id: 1,
    artistName: 'Test Artist',
    foreignArtistId: 'artist-mbid-123',
    monitored: true,
    qualityProfileId: 1,
    rootFolderPath: '/music',
    statistics: {
      albumCount: 5,
      trackFileCount: 50
    }
  },

  mockAlbum: {
    id: 1,
    title: 'Test Album',
    foreignAlbumId: 'album-mbid-123',
    artistId: 1,
    monitored: true,
    grabbed: false,
    statistics: {
      trackCount: 10,
      trackFileCount: 10,
      percentOfTracks: 100
    },
    artist: {
      id: 1,
      artistName: 'Test Artist',
      foreignArtistId: 'artist-mbid-123'
    }
  },

  mockQualityProfiles: [
    { id: 1, name: 'Standard' },
    { id: 2, name: 'High Quality' },
    { id: 3, name: 'Lossless' }
  ],

  mockRootFolders: [
    {
      id: 1,
      path: '/music',
      accessible: true,
      freeSpace: 1000000000,
      totalSpace: 2000000000
    }
  ]
};