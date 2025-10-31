const { requestQueue, getUserId } = require('../queue');

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Queue Service', () => {
  beforeEach(() => {
    requestQueue.queue = [];
    requestQueue.activeRequests.clear();
  });

  describe('getUserId', () => {
    it('should extract user ID from session', () => {
      const req = {
        session: {
          user: {
            claims: { sub: 'user-123' }
          }
        }
      };
      expect(getUserId(req)).toBe('user-123');
    });

    it('should fall back to IP address', () => {
      const req = { ip: '127.0.0.1' };
      expect(getUserId(req)).toBe('127.0.0.1');
    });
  });

  describe('request queueing', () => {
    it('should process requests in order', async () => {
      const results = [];
      const req1 = requestQueue.add('user1', async () => {
        results.push(1);
        return 1;
      });
      const req2 = requestQueue.add('user1', async () => {
        results.push(2);
        return 2;
      });

      await Promise.all([req1, req2]);
      expect(results).toEqual([1, 2]);
    });

    it('should handle request failures', async () => {
      const failingRequest = requestQueue.add('user1', async () => {
        throw new Error('Test error');
      });

      await expect(failingRequest).rejects.toThrow('Test error');
    });

    it('should respect concurrent request limits', async () => {
      const maxConcurrent = requestQueue.maxConcurrent;
      const promises = [];

      for (let i = 0; i < maxConcurrent + 5; i++) {
        promises.push(
          requestQueue.add('user1', async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return i;
          })
        );
      }

      // Some should be queued
      expect(requestQueue.getStats().queueLength).toBeGreaterThan(0);

      await Promise.all(promises);
    });
  });
});