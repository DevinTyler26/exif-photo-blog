import { createConnection } from 'node:net';
import { connect as createTlsConnection } from 'node:tls';
import type { Socket } from 'node:net';
import { REDIS_URL } from '@/app/config';

type RedisValue = string | number | null | RedisValue[];
type ParsedReply = { value: RedisValue, bytesRead: number };
type PendingReply = {
  resolve: (value: RedisValue) => void,
  reject: (error: Error) => void,
};

const REDIS_TIMEOUT_MS = 5_000;
const CRLF = Buffer.from('\r\n');

const parseReply = (
  buffer: Buffer,
  offset = 0,
): ParsedReply | undefined => {
  if (offset >= buffer.length) { return; }

  const prefix = buffer[offset];
  const lineEnd = buffer.indexOf(CRLF, offset + 1);
  if (lineEnd < 0) { return; }

  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + CRLF.length;

  switch (prefix) {
    case 43: // Simple string
      return { value: line, bytesRead: afterLine - offset };
    case 45: // Error
      throw new Error(`Redis command failed: ${line}`);
    case 58: // Integer
      return { value: Number(line), bytesRead: afterLine - offset };
    case 36: { // Bulk string
      const size = Number(line);
      if (size === -1) {
        return { value: null, bytesRead: afterLine - offset };
      }
      const bodyStart = afterLine;
      const bodyEnd = bodyStart + size;
      if (buffer.length < bodyEnd + CRLF.length) { return; }
      return {
        value: buffer.toString('utf8', bodyStart, bodyEnd),
        bytesRead: bodyEnd + CRLF.length - offset,
      };
    }
    case 42: { // Array
      const size = Number(line);
      if (size === -1) {
        return { value: null, bytesRead: afterLine - offset };
      }
      const values: RedisValue[] = [];
      let cursor = afterLine;
      for (let index = 0; index < size; index++) {
        const reply = parseReply(buffer, cursor);
        if (!reply) { return; }
        values.push(reply.value);
        cursor += reply.bytesRead;
      }
      return { value: values, bytesRead: cursor - offset };
    }
    default:
      throw new Error(`Unsupported Redis response type: ${prefix}`);
  }
};

const encodeCommand = (parts: string[]) => {
  const fields = parts.map(part => {
    const value = Buffer.from(part);
    return Buffer.concat([
      Buffer.from(`$${value.length}\r\n`),
      value,
      CRLF,
    ]);
  });
  return Buffer.concat([
    Buffer.from(`*${fields.length}\r\n`),
    ...fields,
  ]);
};

const createRedisSocket = (url: URL) =>
  new Promise<Socket>((resolve, reject) => {
    const secure = url.protocol === 'rediss:';
    const socket = secure
      ? createTlsConnection({
        host: url.hostname,
        port: Number(url.port || 6380),
        servername: url.hostname,
      })
      : createConnection({
        host: url.hostname,
        port: Number(url.port || 6379),
      });

    let connected = false;
    const onError = (error: Error) => {
      if (!connected) { reject(error); }
    };
    socket.on('error', onError);
    socket.setTimeout(
      REDIS_TIMEOUT_MS,
      () => socket.destroy(new Error('Timed out connecting to Redis')),
    );
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      connected = true;
      resolve(socket);
    });
  });

const executeRedisCommand = async (parts: string[]): Promise<RedisValue> => {
  if (!REDIS_URL) { throw new Error('REDIS_URL is required'); }

  const url = new URL(REDIS_URL);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }

  const database = url.pathname.slice(1);
  if (database && !/^\d+$/.test(database)) {
    throw new Error('REDIS_URL path must be a numeric database index');
  }

  const socket = await createRedisSocket(url);
  socket.setTimeout(
    REDIS_TIMEOUT_MS,
    () => socket.destroy(new Error('Timed out waiting for Redis')),
  );

  let buffer = Buffer.alloc(0);
  let pending: PendingReply[] = [];

  const failPending = (error: Error) => {
    const replies = pending;
    pending = [];
    replies.forEach(reply => reply.reject(error));
  };

  socket.on('error', failPending);
  socket.on('close', () => {
    if (pending.length > 0) {
      failPending(new Error('Redis connection closed before replying'));
    }
  });
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (pending.length > 0) {
      let reply: ParsedReply | undefined;
      try {
        reply = parseReply(buffer);
      } catch (error) {
        const current = pending.shift();
        current?.reject(error as Error);
        continue;
      }
      if (!reply) { return; }
      buffer = buffer.subarray(reply.bytesRead);
      pending.shift()?.resolve(reply.value);
    }
  });

  const send = (command: string[]) => new Promise<RedisValue>(
    (resolve, reject) => {
      pending.push({ resolve, reject });
      socket.write(encodeCommand(command), error => {
        if (error) { reject(error); }
      });
    },
  );

  try {
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (password) {
      await send(username
        ? ['AUTH', username, password]
        : ['AUTH', password]);
    }
    if (database && database !== '0') {
      await send(['SELECT', database]);
    }
    return await send(parts);
  } finally {
    socket.destroy();
  }
};

export const getRedis = () => REDIS_URL
  ? { command: executeRedisCommand }
  : undefined;

export const warmRedisConnection = () => {
  const redis = getRedis();
  if (redis) {
    void redis.command(['PING']).catch(error => {
      console.error('Failed to warm the Redis connection', error);
    });
  }
};

export const testRedisConnection = async () => {
  const redis = getRedis();
  if (!redis) { throw new Error('REDIS_URL is required'); }
  return redis.command(['PING']);
};
