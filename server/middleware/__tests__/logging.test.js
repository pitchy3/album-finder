// server/middleware/__tests__/logging.test.js
const { createLoggingMiddleware, markCacheHit } = require('../logging');
const { database } = require('../../services/database');

jest.mock('../../services/database');

describe('Logging Middleware', () => {
  let middleware;
  let req, res, next;

  beforeEach(() => {
    middleware = createLoggingMiddleware();
    
    req = {
      path: '/api/musicbrainz/recording',
      originalUrl: '/api/musicbrainz/recording?query=test',
      method: 'GET',
      query: { query: 'test song' },
      session: {
        user: {
          claims: {
            sub: 'user-123',
            preferred_username: 'testuser',
            email: 'test@example.com'
          }
        }
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn((header) => {
        if (header === 'User-Agent') return 'Test Agent';
        return null;
      })
    };

    res = {
      json: jest.fn(function(data) {
        this.locals = this.locals || {};
        this.locals.responseData = data;
        return this;
      }),
      on: jest.fn(),
      locals: {},
      statusCode: 200
    };

    next = jest.fn();

    database.logQuery.mockClear();
  });

  it('should only log specific endpoints', () => {
    req.path = '/api/other-endpoint';
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(database.logQuery).not.toHaveBeenCalled();
  });

  it('should log musicbrainz recording queries', (done) => {
    middleware(req, res, next);
    
    // Simulate response
    res.json({ recordings: [{ title: 'Test Song' }] });
    
    // Simulate finish event
    const finishHandler = res.on.mock.calls.find(call => call[0] === 'finish')[1];
    
    setTimeout(() => {
      finishHandler();
      
      setTimeout(() => {
        expect(database.logQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-123',
            username: 'testuser',
            email: 'test@example.com',
            endpoint: '/api/musicbrainz/recording',
            searchType: 'musicbrainz_recording_search'
          })
        );
        done();
      }, 100);
    }, 50);
  });

  it('should extract artist from search query', (done) => {
    req.query.query = 'recording:"Test Song" AND artistname:"Test Artist"';
    middleware(req, res, next);
    
    res.json({ recordings: [] });
    
    const finishHandler = res.on.mock.calls.find(call => call[0] === 'finish')[1];
    
    setTimeout(() => {
      finishHandler();
      
      setTimeout(() => {
        expect(database.logQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            searchTerm: 'Test Song',
            artist: 'Test Artist'
          })
        );
        done();
      }, 100);
    }, 50);
  });

  it('should mark cache hits', () => {
    const testRes = { locals: {} };
    markCacheHit(testRes);
    expect(testRes.locals.cacheHit).toBe(true);
  });

  it('should handle errors gracefully', (done) => {
    database.logQuery.mockRejectedValue(new Error('Database error'));
    
    middleware(req, res, next);
    res.json({ recordings: [] });
    
    const finishHandler = res.on.mock.calls.find(call => call[0] === 'finish')[1];
    
    setTimeout(() => {
      finishHandler();
      setTimeout(() => {
        // Should not throw
        done();
      }, 100);
    }, 50);
  });
});
