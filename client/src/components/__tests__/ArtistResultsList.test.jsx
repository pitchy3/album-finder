import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ArtistResultsList from '../../components/ArtistResultsList';
import { PreferencesProvider } from '../../contexts/PreferencesContext';

describe('ArtistResultsList', () => {
  it('shows Other Releases expanded and keeps the aggregate control in sync', () => {
    render(
      <PreferencesProvider>
        <ArtistResultsList
          results={[{
            mbid: 'broadcast-123',
            title: 'Test Broadcast',
            artist: 'Test Artist',
            releaseType: 'other',
            inLidarr: false,
            fullyAvailable: false,
            percentComplete: 0
          }]}
          onAddToLidarr={vi.fn()}
          progress={{ loaded: 1, total: 1 }}
          artistStatus={{ artistInLidarr: true, creationState: 'ready' }}
          loading={false}
        />
      </PreferencesProvider>
    );

    expect(screen.getByText('❓ Other Releases')).toBeInTheDocument();
    expect(screen.getByText('Test Broadcast')).toBeInTheDocument();

    const collapseAll = screen.getByRole('button', { name: /Collapse All/ });
    fireEvent.click(collapseAll);

    expect(screen.queryByText('Test Broadcast')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand All/ })).toBeInTheDocument();
  });
});
