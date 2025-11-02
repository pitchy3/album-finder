// server/services/__tests__/rateLimit.test.js
const { rateLimitedFetch } = require('../rateLimit');
const config = require('../../config');

global.fetch = jest.fn();

describe('Rate Limit Service', () => {
  beforeEach(() => {
    global.fetch.mockClear();
    config.rateLimit.musicbrainzDelay = 100; // Fast for testing
  });

  it('should add rate limiting delay between requests', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' })
    });

    const start = Date.now();
    
    await rateLimitedFetch('https://musicbrainz.org/test1');
    await rateLimitedFetch('https://musicbrainz.org/test2');
    
    const duration = Date.now() - start;
    
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should include User-Agent header', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    
    await rateLimitedFetch('https://musicbrainz.org/test');
    
    expect(global.fetch).toHaveBeenCalledWith(
      'https://musicbrainz.org/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': config.userAgent
        })
      })
    );
  });

  it('should merge custom headers', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    
    await rateLimitedFetch('https://musicbrainz.org/test', {
      headers: { 'Custom-Header': 'value' }
    });
    
    expect(global.fetch).toHaveBeenCalledWith(
      'https://musicbrainz.org/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': config.userAgent,
          'Custom-Header': 'value'
        })
      })
    );
  });
});