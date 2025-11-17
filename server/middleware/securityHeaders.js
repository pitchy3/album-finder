// server/middleware/securityHeaders.js - Comprehensive security headers
const config = require('../config');

/**
 * Apply security headers to all responses
 * Includes CSP, HSTS, frame protection, etc.
 */
function securityHeaders(app) {
  console.log('🛡️  Configuring security headers...');
  
  const isProduction = config.server.nodeEnv === 'production';
  const cookieSecure = process.env.COOKIE_SECURE !== 'false';
  
  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    // Allow inline scripts for React (consider using nonce in production)
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Allow inline styles and Google Fonts
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Allow fonts from Google Fonts
    "font-src 'self' https://fonts.gstatic.com data:",
    // Allow images from self, data URIs, and Cover Art Archive
    "img-src 'self' data: https: http://coverartarchive.org https://coverartarchive.org https://images.lidarr.audio",
    // Allow connections to self (API calls)
    "connect-src 'self'",
    // Deny frames
    "frame-src 'none'",
    // Deny objects
    "object-src 'none'",
    // Allow media from self
    "media-src 'self'",
    // Base URI restriction
    "base-uri 'self'",
    // Form action restriction
    "form-action 'self'"
  ];
  
  // Main security headers middleware
  app.use((req, res, next) => {
    // Add upgrade-insecure-requests in production with HTTPS
    if (isProduction && cookieSecure && !cspDirectives.includes("upgrade-insecure-requests")) {
      cspDirectives.push("upgrade-insecure-requests");
    }
    
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
    
    // Strict Transport Security (only if using HTTPS)
    if (cookieSecure) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }
    
    // X-Frame-Options (prevent clickjacking)
    res.setHeader('X-Frame-Options', 'DENY');
    
    // X-Content-Type-Options (prevent MIME sniffing)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // X-XSS-Protection (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions Policy (formerly Feature-Policy)
    const permissionsPolicy = [
      'geolocation=()',
      'microphone=()',
      'camera=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
      'gyroscope=()',
      'accelerometer=()',
      'ambient-light-sensor=()',
      'autoplay=()',
      'encrypted-media=()',
      'picture-in-picture=()'
    ];
    res.setHeader('Permissions-Policy', permissionsPolicy.join(', '));
    
    // Cross-Origin Policies
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    
    // Remove X-Powered-By header (information disclosure)
    res.removeHeader('X-Powered-By');
    
    next();
  });

  // Additional cache control for sensitive endpoints
  app.use('/api/', (req, res, next) => {
    // Don't cache API responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Security.txt file (RFC 9116)
  app.get('/.well-known/security.txt', (req, res) => {
    const securityTxt = `Contact: security@example.com
Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}
Preferred-Languages: en
Canonical: https://${req.get('host')}/.well-known/security.txt

# Security Policy
# Report security vulnerabilities to the contact above
# PGP key: [Add your PGP key URL here if you have one]
`;
    
    res.type('text/plain').send(securityTxt);
  });

  // robots.txt (prevent indexing of sensitive paths)
  app.get('/robots.txt', (req, res) => {
    const robotsTxt = `User-agent: *
Disallow: /api/
Disallow: /auth/
Disallow: /webhook/
Allow: /

# Sitemap: https://${req.get('host')}/sitemap.xml
`;
    
    res.type('text/plain').send(robotsTxt);
  });

  console.log('✅ Security headers configured');
  console.log(`   CSP: ${cspDirectives.length} directives`);
  console.log(`   HSTS: ${cookieSecure ? 'Enabled' : 'Disabled (HTTP mode)'}`);
  console.log(`   Frame protection: DENY`);
  console.log(`   MIME sniffing: Prevented`);
  console.log('   COEP: credentialless (allows external images)');
  console.log('   CORP: cross-origin (allows external resources)');
}

/**
 * Report-Only CSP for testing without breaking functionality
 * Use this to test CSP before enforcing
 */
function reportOnlyCSP(app) {
  app.use((req, res, next) => {
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'"
    ];
    
    res.setHeader('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
    next();
  });
}

/**
 * Nonce generator for CSP script-src (more secure than 'unsafe-inline')
 * Requires modifying HTML templates to include nonce
 */
function generateNonce() {
  return require('crypto').randomBytes(16).toString('base64');
}

/**
 * Add nonce to CSP header and make it available to templates
 */
function cspNonceMiddleware(req, res, next) {
  res.locals.nonce = generateNonce();
  
  // Override CSP header to include nonce
  const originalSetHeader = res.setHeader;
  res.setHeader = function(name, value) {
    if (name === 'Content-Security-Policy') {
      // Replace 'unsafe-inline' with nonce
      value = value.replace(
        "script-src 'self' 'unsafe-inline'",
        `script-src 'self' 'nonce-${res.locals.nonce}'`
      );
    }
    return originalSetHeader.call(this, name, value);
  };
  
  next();
}

/**
 * Subresource Integrity (SRI) helper
 * Generate SRI hashes for external scripts/styles
 */
function generateSRIHash(content, algorithm = 'sha384') {
  const crypto = require('crypto');
  const hash = crypto.createHash(algorithm).update(content).digest('base64');
  return `${algorithm}-${hash}`;
}

/**
 * Development mode security headers (less strict)
 */
function developmentSecurityHeaders(app) {
  console.log('🛡️  Configuring security headers (development mode)...');
  
  app.use((req, res, next) => {
    // More permissive CSP for development
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https: http:; connect-src 'self' ws: wss:"
    );
    
    // Basic security headers
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Less strict for dev
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.removeHeader('X-Powered-By');
	
	res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    next();
  });
  
  console.log('✅ Development security headers configured');
}

module.exports = {
  securityHeaders,
  reportOnlyCSP,
  cspNonceMiddleware,
  generateNonce,
  generateSRIHash,
  developmentSecurityHeaders
};