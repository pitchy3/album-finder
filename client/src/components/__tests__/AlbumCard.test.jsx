import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AlbumCard from '../../components/AlbumCard';
import { PreferencesProvider } from '../../contexts/PreferencesContext';

describe('AlbumCard', () => {
  const mockAlbum = {
    mbid: 'album-123',
    title: 'Test Album',
    artist: 'Test Artist',
    releaseType: 'album',
    releaseDate: '2024-01-01',
    score: 0.95,
    coverUrl: 'https://example.com/cover.jpg',
    inLidarr: false,
    fullyAvailable: false,
    percentComplete: 0
  };

  let mockOnAddToLidarr;

  beforeEach(() => {
    mockOnAddToLidarr = vi.fn();
    // Clear any previous mock state
    vi.clearAllMocks();
  });
  
  const renderComponent = (album = mockAlbum, props = {}) => {
    return render(
      <PreferencesProvider>
        <AlbumCard
          album={album}
          index={0}
          onAddToLidarr={mockOnAddToLidarr}
		  artistInLidarr={false}
          {...props}
        />
      </PreferencesProvider>
    );
  };

  it('should render album information', () => {
    renderComponent();
    
    expect(screen.getByText('Test Album')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
  });

  it('should show match score', () => {
    renderComponent();
    
    expect(screen.getByText('Match: 95%')).toBeInTheDocument();
  });

  it('should display cover art when available', () => {
    renderComponent();
    
    const img = screen.getByAltText('Test Album cover');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  it('should show placeholder when no cover art', () => {
    const albumNoCover = { ...mockAlbum, coverUrl: null };
    renderComponent(albumNoCover);
    
    expect(screen.getByText('🎵')).toBeInTheDocument();
  });

  it('should call onAddToLidarr when add button clicked', () => {
    // When artist EXISTS in Lidarr, should call directly
    renderComponent(mockAlbum, { artistInLidarr: true });
    
    const addButton = screen.getByText('➕ Add to Lidarr');
    fireEvent.click(addButton);
    
    // Should call with album and null (backend will use artist's folder)
    expect(mockOnAddToLidarr).toHaveBeenCalledWith(mockAlbum, null);
  });

  it('should show complete status when in Lidarr', () => {
    const completedAlbum = {
      ...mockAlbum,
      inLidarr: true,
      fullyAvailable: true,
      percentComplete: 100
    };
    renderComponent(completedAlbum);
    
    expect(screen.getByText('✅ In Lidarr (Complete)')).toBeInTheDocument();
  });

  it('should disable add button when in Lidarr', () => {
    const completedAlbum = {
      ...mockAlbum,
      inLidarr: true,
      fullyAvailable: true,
      percentComplete: 100
    };
    renderComponent(completedAlbum);
    
    const button = screen.getByText('✅ In Lidarr (Complete)');
    expect(button).toBeDisabled();
  });

  it('should show and disable the pending state while an album is being added', () => {
    renderComponent({ ...mockAlbum, addState: 'adding' });

    expect(screen.getByText('⏳ Adding to Lidarr…')).toBeDisabled();
  });

  it('should disable sibling albums while a new artist is being created', () => {
    renderComponent(mockAlbum, { artistCreationState: 'creating' });

    const button = screen.getByText('⏳ Adding artist to Lidarr…');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockOnAddToLidarr).not.toHaveBeenCalled();
  });

  it('should disable another request while a search request is being processed', () => {
    renderComponent({
      ...mockAlbum,
      inLidarr: true,
      addState: 'queued'
    });

    expect(screen.getByText('🔎 Search requested…')).toBeDisabled();
    expect(screen.queryByText('➕ Add to Lidarr')).not.toBeInTheDocument();
  });

  it('should allow another search for a monitored album with no downloaded tracks', () => {
    const album = {
      ...mockAlbum,
      inLidarr: true,
      monitored: true,
      percentComplete: 0
    };
    renderComponent(album, { artistInLidarr: true });

    const button = screen.getByText('🔎 Monitored — Search again');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockOnAddToLidarr).toHaveBeenCalledWith(album, null);
  });

  it('should allow another search for a partially downloaded album', () => {
    const album = {
      ...mockAlbum,
      monitored: true,
      inLidarr: true,
      percentComplete: 42
    };
    renderComponent({
      ...album
    }, { artistInLidarr: true });

    const button = screen.getByText('🔎 42% downloaded — Search again');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockOnAddToLidarr).toHaveBeenCalledWith(album, null);
  });

  it('should allow retry after an add failure', () => {
    renderComponent({ ...mockAlbum, addState: 'error' }, { artistInLidarr: true });

    fireEvent.click(screen.getByText('↻ Retry adding to Lidarr'));
    expect(mockOnAddToLidarr).toHaveBeenCalledWith(
      expect.objectContaining({ mbid: 'album-123' }),
      null
    );
  });

  it('should link to MusicBrainz', () => {
    renderComponent();
    
    const link = screen.getByText('🔗 View on MusicBrainz');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://musicbrainz.org/release-group/album-123');
  });
});
