// server/middleware/__tests__/auth.test.js
const { ensureAuthenticated } = require('../auth');
const config = require('../../config');

describe('Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      session: {},
      path: '/test',
      xhr: false,
      headers: {},
      originalUrl: '/test'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      redirect: jest.fn()
    };
    next = jest.fn();
  });

  describe('when auth is disabled', () => {
    beforeEach(() => {
      config.auth.enabled = false;
    });

    it('should call next without checking session', () => {
      ensureAuthenticated(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('when auth is enabled', () => {
    beforeEach(() => {
      config.auth.enabled = true;
    });

    it('should call next if user is authenticated', () => {
      req.session.user = { claims: { sub: 'user-123' } };
      ensureAuthenticated(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 401 for unauthenticated API requests', () => {
      req.path = '/api/test';
      ensureAuthenticated(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        loginUrl: '/auth/login'
      });
    });

    it('should redirect to login for unauthenticated page requests', () => {
      req.path = '/dashboard';
      req.originalUrl = '/dashboard?tab=albums';
      
      ensureAuthenticated(req, res, next);
      
      expect(req.session.returnTo).toBe('/dashboard?tab=albums');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should detect API requests by XHR header', () => {
      req.xhr = true;
      ensureAuthenticated(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalled();
    });

    it('should detect API requests by content-type', () => {
      req.headers['content-type'] = 'application/json';
      ensureAuthenticated(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalled();
    });

    it('should handle missing session object', () => {
      req.session = undefined;
      ensureAuthenticated(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session not initialized'
      });
    });
  });
});
