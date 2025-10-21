// server/services/redis.js - Redis connection management
const redis = require("redis");
const config = require("../config");

let redisClient = null;
let redisConnected = false;

async function initializeRedis() {
  try {
    redisClient = redis.createClient({
      url: config.redis.url,
      socket: {
        connectTimeout: 5000,
        lazyConnect: true,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.error("❌ Redis connection failed after 3 retries, using memory sessions");
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
      redisConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
      redisConnected = true;
    });

    redisClient.on('disconnect', () => {
      console.log('⚠️  Redis disconnected');
      redisConnected = false;
    });

    await redisClient.connect();
    return true;
  } catch (error) {
    console.warn("⚠️  Redis connection failed, falling back to memory sessions:", error.message);
    redisClient = null;
    redisConnected = false;
    return false;
  }
}

function getClient() {
  return redisClient;
}

function isConnected() {
  return redisConnected;
}

async function closeRedis() {
  if (redisClient) {
    console.log("🔌 Closing Redis connection...");
    await redisClient.quit().catch(console.error);
  }
}

module.exports = {
  initializeRedis,
  getClient,
  isConnected,
  closeRedis
};