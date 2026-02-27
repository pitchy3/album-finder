const request = require('supertest');
const express = require('express');

jest.mock('../../services/rateLimit', () => ({
  rateLimitedFetch: jest.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 75));
    return {
      ok: true,
      status: 200,
      json: async () => ({ recordings: [] })
    };
  })
}));

const { rateLimitedFetch } = require('../../services/rateLimit');
const { cache } = require('../../services/cache');
const apiRoutes = require('../../routes/api');

describe('API Performance Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
  });

  beforeEach(() => {
    cache.flushAll();
    rateLimitedFetch.mockClear();
  });

  test('should handle concurrent requests efficiently', async () => {
    const startTime = Date.now();
    const requests = Array(50).fill().map(() =>
      request(app).get('/api/debug')
    );

    const responses = await Promise.all(requests);
    const endTime = Date.now();
    const duration = endTime - startTime;

    // All requests should succeed
    responses.forEach(res => {
      expect(res.status).toBe(200);
    });

    // Should complete within reasonable time
    expect(duration).toBeLessThan(5000); // 5 seconds for 50 requests
  });

  test('should maintain performance with cache', async () => {
    const firstResponse = await request(app).get('/api/musicbrainz/recording?query=test');
    const secondResponse = await request(app).get('/api/musicbrainz/recording?query=test');

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(rateLimitedFetch).toHaveBeenCalledTimes(1);
  });

  test('should handle queue overflow gracefully', async () => {
    const requests = Array(200).fill().map((_, i) =>
      request(app).get(`/api/debug?id=${i}`)
    );

    const responses = await Promise.allSettled(requests);

    // Most should succeed
    const successful = responses.filter(r =>
      r.status === 'fulfilled' && r.value.status === 200
    );
    expect(successful.length).toBeGreaterThan(150);
  });
});
