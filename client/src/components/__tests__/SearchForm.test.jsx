import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SearchForm from '../../components/SearchForm';
import { PreferencesProvider } from '../../contexts/PreferencesContext';

describe('SearchForm', () => {
  const mockOnSubmit = vi.fn();

  const renderComponent = (props = {}) => {
    return render(
      <PreferencesProvider>
        <SearchForm
          track=""
          setTrack={vi.fn()}
          artist=""
          setArtist={vi.fn()}
          onSubmit={mockOnSubmit}
          loading={false}
          {...props}
        />
      </PreferencesProvider>
    );
  };

  it('should render track and artist inputs', () => {
    renderComponent();
    
    const trackInput = screen.getByPlaceholderText('Track name');
    const artistInput = screen.getByPlaceholderText('Artist name');
    
    expect(trackInput).toBeInTheDocument();
    expect(artistInput).toBeInTheDocument();
  });

  it('should call onSubmit when form is submitted', async () => {
    const user = userEvent.setup();
    renderComponent();

    const button = screen.getByText('Find Albums');
    await user.click(button);

    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('should disable inputs when disabled prop is true', () => {
    renderComponent({ disabled: true });

    const trackInput = screen.getByPlaceholderText('Track name');
    const artistInput = screen.getByPlaceholderText('Artist name');
    
    expect(trackInput).toBeDisabled();
    expect(artistInput).toBeDisabled();
  });

  it('should show loading state', () => {
    renderComponent({ loading: true });

    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('should support keyboard submission', async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText('Track name');
    await user.type(input, '{Enter}');

    expect(mockOnSubmit).toHaveBeenCalled();
  });
});