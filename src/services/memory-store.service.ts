/**
 * In-memory key-value store that implements the same interface as ioredis
 * used across the project. Drop-in replacement for Redis when USE_REDIS=false.
 */

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const ttls = new Map<string, NodeJS.Timeout>();

function clearTtl(key: string) {
  const timer = ttls.get(key);
  if (timer) { clearTimeout(timer); ttls.delete(key); }
}

const memoryStore = {
  async get(key: string): Promise<string | null> {
    return store.get(key) ?? null;
  },

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    clearTtl(key);
    store.set(key, value);
    // Support: set(key, value, 'EX', seconds)
    if (args[0] === 'EX' && typeof args[1] === 'number') {
      const timer = setTimeout(() => { store.delete(key); ttls.delete(key); }, args[1] * 1000);
      ttls.set(key, timer);
    }
    return 'OK';
  },

  async del(...keys: (string | string[])[]): Promise<number> {
    const flat = keys.flat();
    let count = 0;
    for (const k of flat) {
      clearTtl(k);
      if (store.delete(k)) count++;
      if (sets.delete(k)) count++;
    }
    return count;
  },

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const result: string[] = [];
    for (const k of store.keys()) {
      if (regex.test(k)) result.push(k);
    }
    return result;
  },

  async smembers(key: string): Promise<string[]> {
    const s = sets.get(key);
    return s ? Array.from(s) : [];
  },

  async sadd(key: string, ...members: (string | number | Buffer)[]): Promise<number> {
    if (!sets.has(key)) sets.set(key, new Set());
    const s = sets.get(key)!;
    let added = 0;
    for (const m of members) {
      const v = String(m);
      if (!s.has(v)) { s.add(v); added++; }
    }
    return added;
  },

  async scard(key: string): Promise<number> {
    const s = sets.get(key);
    return s ? s.size : 0;
  },

  async srem(key: string, ...members: (string | number | Buffer)[]): Promise<number> {
    const s = sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(String(m))) removed++;
    }
    return removed;
  },

  pipeline() {
    const commands: Array<{ method: string; args: any[] }> = [];

    const pipe: any = {
      set(key: string, value: string, ...args: any[]) {
        commands.push({ method: 'set', args: [key, value, ...args] });
        return pipe;
      },
      sadd(key: string, ...members: any[]) {
        commands.push({ method: 'sadd', args: [key, ...members] });
        return pipe;
      },
      del(...keys: any[]) {
        commands.push({ method: 'del', args: keys });
        return pipe;
      },
      srem(key: string, ...members: any[]) {
        commands.push({ method: 'srem', args: [key, ...members] });
        return pipe;
      },
      async exec() {
        const results: [Error | null, any][] = [];
        for (const cmd of commands) {
          try {
            const fn = (memoryStore as any)[cmd.method];
            const res = await fn(...cmd.args);
            results.push([null, res]);
          } catch (err: any) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };

    return pipe;
  },

  // No-op for compatibility
  disconnect() {},
  on(_event: string, _fn: (...args: any[]) => void) {},
};

console.log('[Store] Using in-memory store (no Redis required)');

export default memoryStore;
