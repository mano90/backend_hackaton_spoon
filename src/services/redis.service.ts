import dotenv from 'dotenv';

dotenv.config();

const useRedis = process.env.USE_REDIS === 'true';

let store: any;

if (useRedis) {
  const Redis = require('ioredis');
  store = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
  store.on('connect', () => console.log('[Store] Connected to Redis'));
  store.on('error', (err: Error) => console.error('[Store] Redis error:', err.message));
} else {
  store = require('./memory-store.service').default;
}

export default store;
