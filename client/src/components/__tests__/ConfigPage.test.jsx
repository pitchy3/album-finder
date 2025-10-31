import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConfigPage from '../../components/ConfigPage';
import { PreferencesProvider } from '../../contexts/PreferencesContext';

// Mock fetch
global.fetch = vi.fn();

describe('ConfigPage', () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'http://lidarr:8686',
        apiKey: '***1234',
        rootFolder: '/music',
        qualityProfileId: 1
      })
    });
  });

  const renderComponent = () => {
    return render(
      <PreferencesProvider>
        <ConfigPage onBack={mockOnBack} />
      </PreferencesProvider>
    );
  };

  it('should render all tabs', () => {
    renderComponent();
    
    // Use getAllByText since "Preferences" appears multiple times (tab + heading)
    const preferencesElements = screen.getAllByText('Preferences');
    expect(preferencesElements.length).toBeGreaterThan(0);
    
    expect(screen.getByText('Lidarr Settings')).toBeInTheDocument();
    expect(screen.getByText('Auth Settings')).toBeInTheDocument();
  });

  it('should switch between tabs', async () => {
    const user = userEvent.setup();
    renderComponent();
    
    const lidarrTab = screen.getByText('Lidarr Settings');
    await user.click(lidarrTab);
    
    await waitFor(() => {
      expect(screen.getByText('Lidarr Configuration')).toBeInTheDocument();
    });
  });

  it('should load Lidarr configuration', async () => {
    renderComponent();
    
    const lidarrTab = screen.getByText('Lidarr Settings');
    await fireEvent.click(lidarrTab);
    
    await waitFor(() => {
      // Check that fetch was called with the correct URL and options
      expect(fetch).toHaveBeenCalledWith(
        '/api/config/lidarr',
        expect.objectContaining({
          credentials: 'include'
        })
      );
    });
  });

  it('should update preferences', async () => {
    const user = userEvent.setup();
    renderComponent();
    
    // Find the toggle by its label text
    const darkModeLabel = screen.getByText('🌙 Dark Mode');
    expect(darkModeLabel).toBeInTheDocument();
    
    // Find the checkbox input - it's a sibling of the label's parent
    const darkModeSection = darkModeLabel.closest('.flex-1');
    const toggleContainer = darkModeSection.parentElement;
    const checkbox = toggleContainer.querySelector('input[type="checkbox"]');
    
    // Verify checkbox exists
    expect(checkbox).not.toBeNull();
    expect(checkbox.tagName).toBe('INPUT');
    
    const initialChecked = checkbox.checked;
    await user.click(checkbox);
    
    // Verify the checkbox state changed
    expect(checkbox.checked).toBe(!initialChecked);
    
    // Check localStorage was updated
    const prefs = JSON.parse(localStorage.getItem('albumfinder-preferences'));
    expect(prefs.darkMode).toBeDefined();
  });
});