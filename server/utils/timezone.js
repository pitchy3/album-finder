// server/utils/timezone.js - Timezone utility functions using native Intl API with dotenv support

// Get timezone from environment variable or default to UTC
const TIMEZONE = process.env.TZ || 'UTC';

// Validate timezone on startup
function validateTimezone(tz = TIMEZONE) {
  try {
    // Test if timezone is valid by trying to create an Intl formatter with it
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (error) {
    console.error(`❌ Invalid timezone "${tz}". Falling back to UTC.`);
    console.error(`   Use valid IANA timezone names (e.g., America/New_York, Europe/London)`);
    return 'UTC';
  }
}

// Initialize and validate timezone
const VALIDATED_TIMEZONE = validateTimezone();

// Create Date instance for current time
function now() {
  return new Date();
}

// Create Date instance from timestamp
function fromTimestamp(timestamp) {
  return new Date(timestamp);
}

// Create Date instance from date string
function fromDate(dateString) {
  return new Date(dateString);
}

// Create Date instance from ISO string
function fromISO(isoString) {
  return new Date(isoString);
}

// Format date for display using Intl.DateTimeFormat
function formatDisplay(date, options = {}) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const defaultOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: VALIDATED_TIMEZONE,
    timeZoneName: 'short'
  };
  
  const formatOptions = { ...defaultOptions, ...options };
  
  try {
    return new Intl.DateTimeFormat('en-US', formatOptions).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return date.toISOString();
  }
}

// Format date for database storage (always UTC ISO string)
function formatForDatabase(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  return date.toISOString();
}

// Format date for API responses (ISO string in user's timezone)
function formatForAPI(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  return date.toISOString();
}

// Get relative time string (e.g., "2 hours ago")
function getRelativeTime(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }
}

// Create Date for specific days ago
function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// Create Date for specific hours ago
function hoursAgo(hours) {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
}

// Create Date for start of day in timezone
function startOfDay(date = null) {
  if (!date) date = new Date();
  if (!(date instanceof Date)) date = new Date(date);
  
  // Get the date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VALIDATED_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const dateString = formatter.format(date);
  const startOfDayInTz = new Date(dateString + 'T00:00:00');
  
  // Convert back to UTC for consistent handling
  const offsetMs = getTimezoneOffset(VALIDATED_TIMEZONE, startOfDayInTz);
  return new Date(startOfDayInTz.getTime() - offsetMs);
}

// Create Date for end of day in timezone
function endOfDay(date = null) {
  if (!date) date = new Date();
  if (!(date instanceof Date)) date = new Date(date);
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VALIDATED_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const dateString = formatter.format(date);
  const endOfDayInTz = new Date(dateString + 'T23:59:59.999');
  
  const offsetMs = getTimezoneOffset(VALIDATED_TIMEZONE, endOfDayInTz);
  return new Date(endOfDayInTz.getTime() - offsetMs);
}

// Helper function to get timezone offset
function getTimezoneOffset(timeZone, date) {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
  return utcDate.getTime() - tzDate.getTime();
}

// Get timezone info
function getTimezoneInfo() {
  const now = new Date();
  
  // Get timezone abbreviation
  const shortFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: VALIDATED_TIMEZONE,
    timeZoneName: 'short'
  });
  const shortParts = shortFormatter.formatToParts(now);
  const abbreviation = shortParts.find(part => part.type === 'timeZoneName')?.value || '';
  
  // Get timezone offset
  const offsetMs = getTimezoneOffset(VALIDATED_TIMEZONE, now);
  const offsetMinutes = Math.round(offsetMs / 60000);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
  
  // Determine if DST is active (approximate)
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const janOffset = getTimezoneOffset(VALIDATED_TIMEZONE, jan);
  const julOffset = getTimezoneOffset(VALIDATED_TIMEZONE, jul);
  const isDST = offsetMs !== Math.max(janOffset, julOffset);
  
  return {
    timezone: VALIDATED_TIMEZONE,
    abbreviation,
    offset,
    offsetMinutes,
    isDST,
    currentTime: formatDisplay(now)
  };
}

// Log timezone initialization with environment variable source
console.log(`🌍 Timezone configured: ${VALIDATED_TIMEZONE}`);
console.log(`📍 Timezone source: ${process.env.TZ ? `TZ environment variable (${process.env.TZ})` : 'default (UTC)'}`);
console.log(`🕐 Current time: ${formatDisplay(now())}`);

module.exports = {
  TIMEZONE: VALIDATED_TIMEZONE,
  now,
  fromTimestamp,
  fromDate,
  fromISO,
  formatDisplay,
  formatForDatabase,
  formatForAPI,
  getRelativeTime,
  daysAgo,
  hoursAgo,
  startOfDay,
  endOfDay,
  getTimezoneInfo,
  validateTimezone
};
