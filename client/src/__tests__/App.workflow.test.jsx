import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.jsx';

const mocks = vi.hoisted(() => ({
  addToLidarr: vi.fn(),
  searchAlbums: vi.fn(),
  beginAlbumAdd: vi.fn(),
  completeAlbumAdd: vi.fn(),
  failAlbumAdd: vi.fn(),
  searchArtistReleases: vi.fn(),
  cancelArtistSearch: vi.fn(),
  beginArtistAlbumAdd: vi.fn(),
  completeArtistAlbumAdd: vi.fn(),
  failArtistAlbumAdd: vi.fn(),
  artistStatus: { artistInLidarr: true, creationState: 'ready' },
  artistResults: [],
  songResults: []
}));

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({
    loading: false,
    authEnabled: false,
    loggedIn: true,
    user: null,
    refreshAuth: vi.fn()
  })
}));

vi.mock('../hooks/useAlbumSearch.js', () => ({
  useAlbumSearch: () => ({
    loading: false,
    results: mocks.songResults,
    error: null,
    searchAlbums: mocks.searchAlbums,
    beginAlbumAdd: mocks.beginAlbumAdd,
    completeAlbumAdd: mocks.completeAlbumAdd,
    failAlbumAdd: mocks.failAlbumAdd
  })
}));

vi.mock('../hooks/useArtistSearchStream.js', () => ({
  useArtistSearchStream: () => ({
    loading: false,
    results: mocks.artistResults,
    error: null,
    warning: null,
    progress: { loaded: mocks.artistResults.length, total: mocks.artistResults.length },
    artistStatus: mocks.artistStatus,
    searchArtistReleases: mocks.searchArtistReleases,
    cancelSearch: mocks.cancelArtistSearch,
    beginArtistAlbumAdd: mocks.beginArtistAlbumAdd,
    completeArtistAlbumAdd: mocks.completeArtistAlbumAdd,
    failArtistAlbumAdd: mocks.failArtistAlbumAdd
  })
}));

vi.mock('../services/lidarrService.js', () => ({
  addToLidarr: mocks.addToLidarr
}));

vi.mock('../components/UserHeader.jsx', () => ({ default: () => <div>User</div> }));
vi.mock('../components/ArtistSearchForm.jsx', () => ({ default: () => <div>Artist form</div> }));
vi.mock('../components/SearchForm.jsx', () => ({ default: () => <div>Song form</div> }));
vi.mock('../components/ErrorDisplay.jsx', () => ({ default: () => null }));
vi.mock('../components/LidarrSetupBanner.jsx', () => ({ default: () => null }));
vi.mock('../components/AuthLoadingScreen.jsx', () => ({ default: () => <div>Loading auth</div> }));
vi.mock('../components/LoginPrompt.jsx', () => ({ default: () => <div>Login</div> }));
vi.mock('../components/ConfigPage.jsx', () => ({ default: () => <div>Config</div> }));
vi.mock('../components/LogsPage.jsx', () => ({ default: () => <div>Logs</div> }));
vi.mock('../components/AuthConfirmationPage.jsx', () => ({ default: () => <div>Confirm</div> }));
vi.mock('../components/ArtistResultsList.jsx', () => ({
  default: ({ results, onAddToLidarr }) => results[0]
    ? <button onClick={() => onAddToLidarr(results[0], results[0].rootFolder || null)}>artist-add</button>
    : null
}));
vi.mock('../components/ResultsList.jsx', () => ({
  default: ({ results, onAddToLidarr }) => results[0]
    ? <button onClick={() => onAddToLidarr(results[0], null)}>song-add</button>
    : null
}));

describe('App album request workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artistStatus = { artistInLidarr: true, creationState: 'ready' };
    mocks.artistResults = [];
    mocks.songResults = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'http://lidarr:8686',
        apiKey: 'configured',
        rootFolder: '/music',
        qualityProfileId: 1
      })
    });
  });

  it('retries an incomplete album for an existing artist without creating the artist', async () => {
    const album = {
      mbid: 'album-1',
      title: 'Unavailable Album',
      artist: 'Existing Artist',
      inLidarr: true,
      monitored: true,
      percentComplete: 0
    };
    mocks.artistResults = [album];
    mocks.addToLidarr.mockResolvedValue({
      success: true,
      data: { state: 'queued', artistId: 5, percentComplete: 0 }
    });

    render(<App />);
    fireEvent.click(screen.getByText('artist-add'));

    await waitFor(() => expect(mocks.completeArtistAlbumAdd).toHaveBeenCalled());
    expect(mocks.beginArtistAlbumAdd).toHaveBeenCalledWith('album-1', false);
    expect(mocks.addToLidarr).toHaveBeenCalledWith(album, null);
    expect(mocks.completeArtistAlbumAdd).toHaveBeenCalledWith(
      'album-1',
      expect.objectContaining({ state: 'queued', artistId: 5 }),
      null
    );
  });

  it('passes the selected root folder and marks the first request as artist creation', async () => {
    const album = {
      mbid: 'album-new',
      title: 'First Album',
      artist: 'New Artist',
      inLidarr: false,
      rootFolder: '/music'
    };
    mocks.artistStatus = { artistInLidarr: false, creationState: 'ready' };
    mocks.artistResults = [album];
    mocks.addToLidarr.mockResolvedValue({
      success: true,
      data: { state: 'queued', artistCreated: true, artistId: 9 }
    });

    render(<App />);
    fireEvent.click(screen.getByText('artist-add'));

    await waitFor(() => expect(mocks.completeArtistAlbumAdd).toHaveBeenCalled());
    expect(mocks.beginArtistAlbumAdd).toHaveBeenCalledWith('album-new', true);
    expect(mocks.addToLidarr).toHaveBeenCalledWith(album, '/music');
    expect(mocks.completeArtistAlbumAdd).toHaveBeenCalledWith(
      'album-new',
      expect.objectContaining({ artistCreated: true }),
      '/music'
    );
  });

  it('restores the artist album failure state when Lidarr rejects a request', async () => {
    const album = {
      mbid: 'album-failed',
      title: 'Failed Album',
      artist: 'Existing Artist',
      inLidarr: true
    };
    mocks.artistResults = [album];
    mocks.addToLidarr.mockResolvedValue({
      success: false,
      data: { success: false, message: 'Rejected' }
    });

    render(<App />);
    fireEvent.click(screen.getByText('artist-add'));

    await waitFor(() => expect(mocks.failArtistAlbumAdd).toHaveBeenCalledWith(
      'album-failed',
      expect.objectContaining({ message: 'Rejected' }),
      null
    ));
    expect(mocks.completeArtistAlbumAdd).not.toHaveBeenCalled();
  });

  it('routes song-search requests through the song lifecycle actions', async () => {
    const album = {
      mbid: 'song-album',
      title: 'Song Album',
      artist: 'Song Artist',
      artistMbid: 'song-artist-mbid',
      artistInLidarr: true,
      inLidarr: false
    };
    mocks.songResults = [album];
    mocks.addToLidarr.mockResolvedValue({
      success: true,
      data: { state: 'queued', artistId: 12 }
    });

    render(<App />);
    fireEvent.click(screen.getByText('🎵 Find by Song'));
    fireEvent.click(screen.getByText('song-add'));

    await waitFor(() => expect(mocks.completeAlbumAdd).toHaveBeenCalled());
    expect(mocks.beginAlbumAdd).toHaveBeenCalledWith('song-album', {
      artistMbid: 'song-artist-mbid',
      artistName: 'Song Artist',
      creatingArtist: false
    });
    expect(mocks.completeAlbumAdd).toHaveBeenCalledWith(
      'song-album',
      expect.objectContaining({ artistId: 12 }),
      { artistMbid: 'song-artist-mbid', artistName: 'Song Artist' }
    );
  });
});
