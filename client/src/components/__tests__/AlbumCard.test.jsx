import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

  const mockOnAddToLidarr = vi.fn();

  const renderComponent = (album = mockAlbum, props = {}) => {
    return render(
      <PreferencesProvider>
        <AlbumCard
          album={album}
          index={0}
          onAddToLidarr={mockOnAddToLidarr}
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
    renderComponent();
    
    const addButton = screen.getByText('➕ Add to Lidarr');
    fireEvent.click(addButton);
    
    expect(mockOnAddToLidarr).toHaveBeenCalledWith(mockAlbum);
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

  it('should link to MusicBrainz', () => {
    renderComponent();
    
    const link = screen.getByText('🔗 View on MusicBrainz');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://musicbrainz.org/release-group/album-123');
  });
});