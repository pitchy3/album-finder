// server/services/rateLimit.js - Rate limiting for external APIs
const config = require("../config");

// Enhanced rate limiting for MusicBrainz
let lastMusicBrainzRequest = 0;

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastMusicBrainzRequest;
  
  if (timeSinceLastRequest < config.rateLimit.musicbrainzDelay) {
    const waitTime = config.rateLimit.musicbrainzDelay - timeSinceLastRequest;
    console.log(`⏱️ Rate limiting: waiting ${waitTime}ms before next MusicBrainz request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastMusicBrainzRequest = Date.now();
  
  const headers = {
    'User-Agent': config.userAgent,
    ...options.headers
  };
  
  return fetch(url, { ...options, headers });
}

module.exports = {
  rateLimitedFetch
};