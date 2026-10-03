import { randomUUID } from 'node:crypto';
import { getRedis } from './redis';

const RATE_LIMIT_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  redis.call('PEXPIRE', KEYS[1], window)
  return 0
end

redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return 1
`;

const parseDurationMs = (duration: string) => {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported Redis rate limit duration: '${duration}'`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[unit as 'ms' | 's' | 'm' | 'h' | 'd'];
  const result = amount * multiplier;

  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`Invalid Redis rate limit duration: '${duration}'`);
  }
  return result;
};

export const checkRateLimitAndThrow = async ({
  identifier,
  tokens = 100,
  duration = '1h',
}: {
  identifier: string
  tokens?: number
  duration?: string
}) => {
  if (!Number.isSafeInteger(tokens) || tokens < 1) {
    throw new Error('Rate limit tokens must be a positive integer');
  }

  const windowMs = parseDurationMs(duration);
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      `REDIS_URL is required to limit outbound requests ('${identifier}')`,
    );
  }

  let success = false;
  try {
    success = Number(await redis.command([
      'EVAL',
      RATE_LIMIT_SCRIPT,
      '1',
      `exif-photo-blog:rate-limit:${identifier}`,
      String(windowMs),
      String(tokens),
      randomUUID(),
    ])) === 1;
  } catch (error) {
    const message =
      `Failed to connect to Redis rate limiting store ('${identifier}')`;
    console.error(message, error);
    throw new Error(message);
  }

  if (!success) {
    const message = `'${identifier}' rate limit exceeded`;
    console.error(message);
    throw new Error(message);
  }
};
