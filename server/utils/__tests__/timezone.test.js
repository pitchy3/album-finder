// server/utils/__tests__/timezone.test.js
const tz = require('../timezone');

describe('Timezone Utils', () => {
  describe('now', () => {
    it('should return current Date', () => {
      const result = tz.now();
      expect(result instanceof Date).toBe(true);
    });
  });

  describe('fromTimestamp', () => {
    it('should create Date from timestamp', () => {
      const timestamp = 1609459200000; // 2021-01-01 00:00:00 UTC
      const result = tz.fromTimestamp(timestamp);
      
      expect(result instanceof Date).toBe(true);
      expect(result.getTime()).toBe(timestamp);
    });
  });

  describe('fromDate', () => {
    it('should create Date from date string', () => {
      const result = tz.fromDate('2024-01-01');
      expect(result instanceof Date).toBe(true);
    });
  });

  describe('fromISO', () => {
    it('should create Date from ISO string', () => {
      const iso = '2024-01-01T00:00:00.000Z';
      const result = tz.fromISO(iso);
      
      expect(result instanceof Date).toBe(true);
      expect(result.toISOString()).toBe(iso);
    });
  });

  describe('formatDisplay', () => {
    it('should format date for display', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = tz.formatDisplay(date);
      
      expect(typeof result).toBe('string');
      expect(result).toContain('2024');
    });

    it('should accept custom format options', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = tz.formatDisplay(date, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      expect(result).toContain('2024');
    });

    it('should handle string input', () => {
      const result = tz.formatDisplay('2024-01-01T12:00:00Z');
      expect(typeof result).toBe('string');
    });
  });

  describe('formatForDatabase', () => {
    it('should format date as ISO string', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = tz.formatForDatabase(date);
      
      expect(result).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should handle string input', () => {
      const result = tz.formatForDatabase('2024-01-01T12:00:00Z');
      expect(typeof result).toBe('string');
    });
  });

  describe('formatForAPI', () => {
    it('should format date for API response', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = tz.formatForAPI(date);
      
      expect(result).toBe('2024-01-01T12:00:00.000Z');
    });
  });

  describe('getRelativeTime', () => {
    it('should return "Just now" for recent dates', () => {
      const date = new Date();
      const result = tz.getRelativeTime(date);
      expect(result).toBe('Just now');
    });

    it('should return minutes ago', () => {
      const date = new Date(Date.now() - 5 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('5 minutes ago');
    });

    it('should return hours ago', () => {
      const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('3 hours ago');
    });

    it('should return days ago', () => {
      const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('5 days ago');
    });

    it('should return weeks ago', () => {
      const date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('2 weeks ago');
    });

    it('should return months ago', () => {
      const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('2 months ago');
    });

    it('should return years ago', () => {
      const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      const result = tz.getRelativeTime(date);
      expect(result).toBe('1 year ago');
    });

    it('should handle string input', () => {
      const dateStr = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = tz.getRelativeTime(dateStr);
      expect(result).toContain('minute');
    });
  });

  describe('daysAgo', () => {
    it('should return date N days ago', () => {
      const result = tz.daysAgo(7);
      const expected = new Date();
      expected.setDate(expected.getDate() - 7);
      
      expect(result.getDate()).toBe(expected.getDate());
    });
  });

  describe('hoursAgo', () => {
    it('should return date N hours ago', () => {
      const result = tz.hoursAgo(5);
      const now = new Date();
      const diff = now.getTime() - result.getTime();
      
      expect(diff).toBeGreaterThanOrEqual(5 * 60 * 60 * 1000 - 1000);
      expect(diff).toBeLessThanOrEqual(5 * 60 * 60 * 1000 + 1000);
    });
  });

  describe('startOfDay', () => {
    it('should return start of day', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const result = tz.startOfDay(date);
      
      expect(result instanceof Date).toBe(true);
    });

    it('should default to today', () => {
      const result = tz.startOfDay();
      expect(result instanceof Date).toBe(true);
    });
  });

  describe('endOfDay', () => {
    it('should return end of day', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const result = tz.endOfDay(date);
      
      expect(result instanceof Date).toBe(true);
    });

    it('should default to today', () => {
      const result = tz.endOfDay();
      expect(result instanceof Date).toBe(true);
    });
  });

  describe('getTimezoneInfo', () => {
    it('should return timezone information', () => {
      const result = tz.getTimezoneInfo();
      
      expect(result).toHaveProperty('timezone');
      expect(result).toHaveProperty('abbreviation');
      expect(result).toHaveProperty('offset');
      expect(result).toHaveProperty('offsetMinutes');
      expect(result).toHaveProperty('isDST');
      expect(result).toHaveProperty('currentTime');
    });

    it('should have valid offset format', () => {
      const result = tz.getTimezoneInfo();
      expect(result.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    });

    it('should have numeric offsetMinutes', () => {
      const result = tz.getTimezoneInfo();
      expect(typeof result.offsetMinutes).toBe('number');
    });
  });

  describe('validateTimezone', () => {
    it('should validate valid timezones', () => {
      const result = tz.validateTimezone('America/New_York');
      expect(result).toBe('America/New_York');
    });

    it('should return UTC for invalid timezones', () => {
      const result = tz.validateTimezone('Invalid/Timezone');
      expect(result).toBe('UTC');
    });

    it('should handle UTC input', () => {
      const result = tz.validateTimezone('UTC');
      expect(result).toBe('UTC');
    });
  });
});