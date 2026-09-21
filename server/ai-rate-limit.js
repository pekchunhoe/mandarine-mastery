import { createHash, randomBytes } from 'node:crypto';
import { TeacherError } from './ai-contract.js';

// Bounded in-memory protection for each function instance. Deployment-wide limits
// belong in Vercel Firewall; no identifier is logged, persisted or sent to Gemini.
export function createTutorLimiter({
  now = Date.now,
  windowMs = 60000,
  perClient = 8,
  total = 40,
  concurrent = 4,
} = {}) {
  const salt = randomBytes(16);
  const clients = new Map();
  let start = now(),
    count = 0,
    active = 0;
  return {
    acquire(request, trustedProxy = false) {
      const time = now();
      if (time - start >= windowMs) {
        start = time;
        count = 0;
        clients.clear();
      }
      const address = trustedProxy
        ? request.headers.get('x-vercel-forwarded-for') || 'shared'
        : 'local';
      const key = createHash('sha256').update(salt).update(address.slice(0, 128)).digest('hex');
      const used = clients.get(key) || 0;
      if (count >= total || used >= perClient || active >= concurrent)
        throw new TeacherError('AI_RATE_LIMIT', 429);
      clients.set(key, used + 1);
      count++;
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
