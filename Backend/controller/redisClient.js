import { createClient } from 'redis';

const redisClient = createClient({
  url: 'redis://default:XBZf2V6AvoLTuXm19tpIKc6Tr76Ttz0z@redis-18965.c93.us-east-1-3.ec2.cloud.redislabs.com:18965',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
  await redisClient.connect();
  console.log('✅ Connected to Redis!');
})();

export default redisClient;
