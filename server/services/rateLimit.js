// server/services/rateLimit.js - Rate limiting for external APIs
const config = require("../config");

// Enhanced rate limiting for MusicBrainz
let lastMusicBrainzRequest = 0;
let schedulingQueue = Promise.resolve();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url, options = {}) {
  // Reserve request start times serially. Without this small scheduling lock,
  // concurrent callers all observe the same timestamp, sleep together, and
  // then hit MusicBrainz simultaneously.
  let releaseSchedule;
  const previousReservation = schedulingQueue;
  schedulingQueue = new Promise(resolve => {
    releaseSchedule = resolve;
  });

  await previousReservation;

  try {
    const now = Date.now();
    const nextAllowedRequestTime = lastMusicBrainzRequest + config.rateLimit.musicbrainzDelay;

    if (now < nextAllowedRequestTime) {
      // Add a 1ms guard to avoid clock granularity/timer jitter causing short waits.
      const waitTime = (nextAllowedRequestTime - now) + 1;
      console.log(`⏱️ Rate limiting: waiting ${waitTime}ms before next MusicBrainz request`);
      await sleep(waitTime);
    }

    lastMusicBrainzRequest = Date.now();
  } finally {
    releaseSchedule();
  }

  const headers = {
    'User-Agent': config.userAgent,
    ...options.headers
  };

  return fetch(url, { ...options, headers });
}

function resetRateLimitState() {
  lastMusicBrainzRequest = 0;
  schedulingQueue = Promise.resolve();
}

module.exports = {
  rateLimitedFetch,
  resetRateLimitState
};
