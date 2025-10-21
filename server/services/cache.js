// server/services/cache.js - Scalable caching service
const NodeCache = require("node-cache");
const config = require("../config");

// Enhanced cache with size limits and memory management
class ScalableCache {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      maxKeys: config.cache.maxSize,
      useClones: false, // Better performance, be careful with object mutations
      deleteOnExpire: true,
      checkperiod: 120 // Check for expired keys every 2 minutes
    });

    this.memoryUsage = 0;
    this.hitCount = 0;
    this.missCount = 0;

    // Monitor memory usage
    this.cache.on('set', (key, value) => {
      this.updateMemoryUsage();
    });

    this.cache.on('del', () => {
      this.updateMemoryUsage();
    });

    this.cache.on('expired', () => {
      this.updateMemoryUsage();
    });

    // Periodic cleanup
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  updateMemoryUsage() {
    // Estimate memory usage (rough calculation)
    const keys = this.cache.keys();
    this.memoryUsage = keys.reduce((total, key) => {
      const value = this.cache.get(key);
      if (value) {
        return total + JSON.stringify(value).length * 2; // Rough bytes estimate
      }
      return total;
    }, 0);
  }

  cleanup() {
    // If memory usage is too high, remove oldest entries
    if (this.memoryUsage > config.cache.maxMemory * 1024 * 1024) {
      console.log(`🧹 Cache cleanup triggered - memory usage: ${Math.round(this.memoryUsage / 1024 / 1024)}MB`);
      
      const keys = this.cache.keys();
      const keysWithStats = keys.map(key => ({
        key,
        stats: this.cache.getStats()[key] || { hits: 0 }
      }));

      // Sort by hit count (ascending) to remove least used items first
      keysWithStats.sort((a, b) => (a.stats.hits || 0) - (b.stats.hits || 0));

      // Remove 25% of entries
      const toRemove = Math.floor(keys.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        this.cache.del(keysWithStats[i].key);
      }

      this.updateMemoryUsage();
      console.log(`✅ Cache cleanup complete - removed ${toRemove} entries, memory: ${Math.round(this.memoryUsage / 1024 / 1024)}MB`);
    }
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.hitCount++;
      return value;
    }
    this.missCount++;
    return null;
  }

  set(key, value, ttl = config.cache.ttl) {
    return this.cache.set(key, value, ttl);
  }

  del(key) {
    return this.cache.del(key);
  }

  getStats() {
    return {
      keys: this.cache.keys().length,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: this.hitCount / (this.hitCount + this.missCount) || 0,
      memoryUsageMB: Math.round(this.memoryUsage / 1024 / 1024),
      maxMemoryMB: config.cache.maxMemory,
      maxKeys: config.cache.maxSize
    };
  }

  flushAll() {
    this.cache.flushAll();
    this.memoryUsage = 0;
  }
}

// Cache utility functions
function getCacheKey(endpoint, params) {
  return `${endpoint}:${JSON.stringify(params)}`;
}

async function cachedFetch(endpoint, params, fetchFunction, ttl = config.cache.ttl) {
  const cacheKey = getCacheKey(endpoint, params);
  const cached = cache.get(cacheKey);
  
  if (cached) {
    cacheLog(`💾 Cache hit for ${endpoint}:`, cacheKey);
    // Set a flag that can be checked by the logging middleware
    if (global.currentRequest && global.currentRequest.res) {
      global.currentRequest.res.locals = global.currentRequest.res.locals || {};
      global.currentRequest.res.locals.cacheHit = true;
    }
    return cached;
  }
  
  cacheLog(`🔥 Cache miss for ${endpoint}:`, cacheKey);
  const data = await fetchFunction();
  cache.set(cacheKey, data, ttl);
  return data;
}

function cacheLog(message, data = null) {
  const debugLogging = false;
  if (debugLogging) {
    if (data) {
      console.log(`${message}`, data);
    } else {
      console.log(`${message}`);
    }
  }
}

// Initialize cache instance
const cache = new ScalableCache();

module.exports = {
  cache,
  getCacheKey,
  cachedFetch
};