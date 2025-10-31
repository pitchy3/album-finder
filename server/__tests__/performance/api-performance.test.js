const request = require('supertest');
const express = require('express');
const apiRoutes = require('../../routes/api');

describe('API Performance Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
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
    // First request (cache miss)
    const firstStart = Date.now();
    await request(app).get('/api/musicbrainz/recording?query=test');
    const firstDuration = Date.now() - firstStart;

    // Second request (cache hit)
    const secondStart = Date.now();
    await request(app).get('/api/musicbrainz/recording?query=test');
    const secondDuration = Date.now() - secondStart;

    // Cached request should be faster
    expect(secondDuration).toBeLessThan(firstDuration);
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