// server/services/__tests__/rateLimit.test.js
const { rateLimitedFetch, resetRateLimitState } = require('../rateLimit');
const config = require('../../config');

global.fetch = jest.fn();

describe('Rate Limit Service', () => {
  beforeEach(() => {
    global.fetch.mockClear();
    resetRateLimitState();
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

  it('spaces concurrent requests instead of releasing them together', async () => {
    config.rateLimit.musicbrainzDelay = 30;
    const starts = [];
    global.fetch.mockImplementation(async () => {
      starts.push(Date.now());
      return { ok: true };
    });

    await Promise.all([
      rateLimitedFetch('https://musicbrainz.org/concurrent-1'),
      rateLimitedFetch('https://musicbrainz.org/concurrent-2'),
      rateLimitedFetch('https://musicbrainz.org/concurrent-3')
    ]);

    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(30);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(30);
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
