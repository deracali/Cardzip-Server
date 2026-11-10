import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL?.trim();
const fallbackValues = new Map();
let connectionPromise;
let reportedUnavailable = false;

const client = redisUrl
  ? createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => (retries < 3 ? Math.min((retries + 1) * 250, 1000) : false),
      },
    })
  : null;

export const isRedisConfigured = Boolean(client);
export const isRedisReady = () => Boolean(client?.isReady);

const reportUnavailable = () => {
  if (reportedUnavailable) return;
  reportedUnavailable = true;
  console.warn('Redis is unavailable; using process-local cache until the connection is restored.');
};

if (client) {
  client.on('error', reportUnavailable);
  client.on('ready', () => {
    reportedUnavailable = false;
  });
}

export const connectRedis = async () => {
  if (!client || client.isReady) return Boolean(client?.isReady);
  if (!connectionPromise) {
    connectionPromise = client.connect()
      .then(() => true)
      .catch(() => {
        reportUnavailable();
        return false;
      })
      .finally(() => {
        connectionPromise = null;
      });
  }
  return connectionPromise;
};

const fallbackGet = (key) => {
  const entry = fallbackValues.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    fallbackValues.delete(key);
    return null;
  }
  return entry.value;
};

const fallbackSet = (key, value, options = {}) => {
  const expirySeconds = Number(options.EX || options.ex || 0);
  fallbackValues.set(key, {
    value: String(value),
    expiresAt: expirySeconds > 0 ? Date.now() + expirySeconds * 1000 : 0,
  });
};

const redisClient = {
  get: async (key) => {
    if (client?.isReady) {
      try {
        return await client.get(key);
      } catch {
        reportUnavailable();
      }
    }
    return fallbackGet(key);
  },
  set: async (key, value, options = {}) => {
    if (client?.isReady) {
      try {
        return await client.set(key, value, options);
      } catch {
        reportUnavailable();
      }
    }
    fallbackSet(key, value, options);
    return 'OK';
  },
  setIfAbsent: async (key, value, seconds = 86400) => {
    if (client?.isReady) {
      try {
        return (await client.set(key, value, { NX: true, EX: seconds })) === 'OK';
      } catch {
        reportUnavailable();
      }
    }
    if (fallbackGet(key) !== null) return false;
    fallbackSet(key, value, { EX: seconds });
    return true;
  },
  extendLock: async (key, value, seconds = 90) => {
    if (client?.isReady) {
      try {
        const result = await client.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
          { keys: [key], arguments: [String(value), String(seconds)] },
        );
        return result === 1;
      } catch {
        reportUnavailable();
      }
    }
    if (fallbackGet(key) !== String(value)) return false;
    fallbackSet(key, value, { EX: seconds });
    return true;
  },
  releaseLock: async (key, value) => {
    if (client?.isReady) {
      try {
        return await client.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [key], arguments: [String(value)] },
        ) === 1;
      } catch {
        reportUnavailable();
      }
    }
    if (fallbackGet(key) !== String(value)) return false;
    fallbackValues.delete(key);
    return true;
  },
  del: async (key) => {
    if (client?.isReady) {
      try {
        return await client.del(key);
      } catch {
        reportUnavailable();
      }
    }
    return fallbackValues.delete(key) ? 1 : 0;
  },
};

export default redisClient;
