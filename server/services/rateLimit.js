// server/services/rateLimit.js - Rate limiting for external APIs
const config = require("../config");

// Enhanced rate limiting for MusicBrainz
let lastMusicBrainzRequest = 0;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now();
  const nextAllowedRequestTime = lastMusicBrainzRequest + config.rateLimit.musicbrainzDelay;

  if (now < nextAllowedRequestTime) {
    // Add a 1ms guard to avoid clock granularity/timer jitter causing short waits.
    const waitTime = (nextAllowedRequestTime - now) + 1;
    console.log(`⏱️ Rate limiting: waiting ${waitTime}ms before next MusicBrainz request`);
    await sleep(waitTime);
  }

  lastMusicBrainzRequest = Date.now();

  const headers = {
    'User-Agent': config.userAgent,
    ...options.headers
  };

  return fetch(url, { ...options, headers });
}

function resetRateLimitState() {
  lastMusicBrainzRequest = 0;
}

module.exports = {
  rateLimitedFetch,
  resetRateLimitState
};
