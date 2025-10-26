const { database } = require('../../services/database');

describe('Database Performance', () => {
  test('should handle bulk inserts efficiently', async () => {
    const startTime = Date.now();
    
    const promises = Array(100).fill().map((_, i) =>
      database.logQuery({
        userId: `user-${i}`,
        endpoint: '/api/test',
        responseStatus: 200,
        responseTime: 100
      })
    );

    await Promise.all(promises);
    const duration = Date.now() - startTime;

    // Should complete bulk inserts quickly
    expect(duration).toBeLessThan(2000); // 2 seconds for 100 inserts
  });

  test('should retrieve statistics efficiently', async () => {
    // Insert test data
    await Promise.all(
      Array(50).fill().map((_, i) =>
        database.logQuery({
          userId: `user-${i % 5}`,
          endpoint: '/api/test',
          responseStatus: 200
        })
      )
    );

    const startTime = Date.now();
    const stats = await database.getStats();
    const duration = Date.now() - startTime;

    expect(stats).toBeDefined();
    expect(duration).toBeLessThan(500); // Should be fast
  });
});