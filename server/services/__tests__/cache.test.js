const { cache, cachedFetch, getCacheKey } = require('../cache');

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

beforeEach(() => {
  cache.flushAll(); // Reset stats before each test
});

afterAll(() => {
  cache.cache.close(); // Stop background TTL timer
});

describe('Cache Service', () => {
  beforeEach(() => {
    cache.flushAll();
  });

  describe('getCacheKey', () => {
    it('should generate consistent cache keys', () => {
      const key1 = getCacheKey('test', { id: 1 });
      const key2 = getCacheKey('test', { id: 1 });
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different params', () => {
      const key1 = getCacheKey('test', { id: 1 });
      const key2 = getCacheKey('test', { id: 2 });
      expect(key1).not.toBe(key2);
    });
  });

  describe('cache operations', () => {
    it('should store and retrieve values', () => {
      cache.set('test-key', { data: 'test' });
      const result = cache.get('test-key');
      expect(result).toEqual({ data: 'test' });
    });

    it('should return null for missing keys', () => {
      const result = cache.get('missing-key');
      expect(result).toBeNull();
    });

    it('should track hit/miss statistics', () => {
      cache.set('test-key', 'value');
      cache.get('test-key'); // hit
      cache.get('missing-key'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('cachedFetch', () => {
    it('should call fetch function on cache miss', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ data: 'test' });
      const result = await cachedFetch('endpoint', {}, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: 'test' });
    });

    it('should not call fetch function on cache hit', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ data: 'test' });
      
      await cachedFetch('endpoint', {}, fetchFn);
      await cachedFetch('endpoint', {}, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });
});