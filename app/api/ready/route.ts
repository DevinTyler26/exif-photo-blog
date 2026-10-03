import { testDatabaseConnection } from '@/platforms/postgres';
import { testRedisConnection } from '@/platforms/redis';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const checks = await Promise.allSettled([
    testDatabaseConnection(),
    testRedisConnection(),
  ]);
  const isReady = checks.every(({ status }) => status === 'fulfilled');

  return new Response(isReady ? 'ready' : 'not ready', {
    status: isReady ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
