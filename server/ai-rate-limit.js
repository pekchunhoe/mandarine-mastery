import { createHash, randomBytes } from 'node:crypto';
import { TeacherError } from './ai-contract.js';

export const DEFAULT_CLIENT_RPM = 12;
export const DEFAULT_TOTAL_RPM = 12;

export function clientRateLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_CLIENT_RPM ? parsed : DEFAULT_CLIENT_RPM;
}

// Bounded in-memory protection for each function instance, not a project-wide cap.
// No identifier is logged, persisted or sent to Gemini.
export function createTutorLimiter({
  now = Date.now,
  windowMs = 60000,
  perClient = DEFAULT_CLIENT_RPM,
  total = DEFAULT_TOTAL_RPM,
  concurrent = 4,
} = {}) {
  const salt = randomBytes(16);
  const clients = new Map();
  const attempts = [];
  let active = 0;
  const prune = (times, time) => {
    while (times.length && times[0] <= time - windowMs) times.shift();
  };
  return {
    acquire(request, trustedProxy = false) {
      const time = now();
      prune(attempts, time);
      for (const [client, times] of clients) {
        prune(times, time);
        if (!times.length) clients.delete(client);
      }
      const address = trustedProxy
        ? request.headers.get('x-vercel-forwarded-for') || 'shared'
        : 'local';
      const key = createHash('sha256').update(salt).update(address.slice(0, 128)).digest('hex');
      const used = clients.get(key) || [];
      if (attempts.length >= total || used.length >= perClient)
        throw new TeacherError('AI_RATE_LIMIT', 429, {
          retryAfterSeconds: Math.max(1, Math.ceil((Math.max(
            attempts.length >= total ? attempts[0] + windowMs : time,
            used.length >= perClient ? used[0] + windowMs : time,
          ) - time) / 1000)),
        });
      // Fail fast; a brief busy condition must not impose a minute-long wait.
      if (active >= concurrent)
        throw new TeacherError('AI_BUSY', 429, { retryAfterSeconds: 1 });
      used.push(time);
      clients.set(key, used);
      attempts.push(time);
      active++;
      let released = false;
      return () => {
        if (!released) {
          active--;
          released = true;
        }
      };
    },
  };
}
