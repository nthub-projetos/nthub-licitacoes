import { createHash } from 'node:crypto';
import { queue } from '../../core/queue.js';
const initialized = new WeakSet<object>();
async function redis() {
  const client = await queue.client;
  if (!initialized.has(client)) {
    client.defineCommand('nthSourceReserve', {
      numberOfKeys: 1,
      lua: `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); local next=tonumber(redis.call('GET',KEYS[1]) or '0'); if next>now then return next-now end; redis.call('SET',KEYS[1],now+tonumber(ARGV[1]),'PX',3600000); return 0`,
    });
    client.defineCommand('nthSourceCooldown', {
      numberOfKeys: 1,
      lua: `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); local next=math.max(tonumber(redis.call('GET',KEYS[1]) or '0'),now+tonumber(ARGV[1])); redis.call('SET',KEYS[1],next,'PX',math.max(3600000,next-now+1000)); return 1`,
    });
    client.defineCommand('nthSourceUnlock', {
      numberOfKeys: 1,
      lua: `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`,
    });
    client.defineCommand('nthSourceLock', {
      numberOfKeys: 1,
      lua: `return redis.call('SET',KEYS[1],ARGV[1],'PX',70000,'NX')`,
    });
    initialized.add(client);
  }
  return client;
}
const prefix = process.env.SOURCE_HTTP_NAMESPACE || 'nthub:official:v1';
const key = (url: string) =>
  prefix + ':cache:' + createHash('sha256').update(url).digest('hex');
export const httpStore = {
  async reserve(host: string, interval: number): Promise<number> {
    const client = await redis();
    return Number(
      await client.runCommand('nthSourceReserve', [
        prefix + ':host:' + host,
        interval,
      ]),
    );
  },
  async cooldown(host: string, ms: number) {
    await (
      await redis()
    ).runCommand('nthSourceCooldown', [prefix + ':host:' + host, ms]);
  },
  async get(url: string) {
    return (await queue.client).get(key(url));
  },
  async put(url: string, value: string) {
    await (await queue.client).set(key(url), value, { EX: 300 });
  },
  async lock(url: string, token: string) {
    return (
      (await (
        await redis()
      ).runCommand('nthSourceLock', [key(url) + ':lock', token])) === 'OK'
    );
  },
  async unlock(url: string, token: string) {
    await (
      await redis()
    ).runCommand('nthSourceUnlock', [key(url) + ':lock', token]);
  },
};
