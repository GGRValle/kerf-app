// Monotonic, time-sortable IDs. ULID-shaped (not ULID-strict): Crockford base32
// encoded time + random suffix. For tests, pass a fixed clock + seeded random.

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I L O U)
const TIME_LEN = 10;
const RAND_LEN = 6;
const RAND_SPACE = 32 ** RAND_LEN; // 1,073,741,824

export interface IdFactoryOpts {
  clock?: () => Date;
  random?: () => number;
}

export interface IdFactory {
  mint(prefix: string): string;
}

export function createIdFactory(opts: IdFactoryOpts = {}): IdFactory {
  const clock = opts.clock ?? (() => new Date());
  const random = opts.random ?? Math.random;

  return {
    mint(prefix: string): string {
      const t = clock().getTime();
      const r = Math.floor(random() * RAND_SPACE);
      return `${prefix}_${encode(t, TIME_LEN)}${encode(r, RAND_LEN)}`;
    },
  };
}

function encode(n: number, len: number): string {
  let out = '';
  let v = Math.max(0, Math.floor(n));
  for (let i = 0; i < len; i++) {
    out = ALPHA.charAt(v % 32) + out;
    v = Math.floor(v / 32);
  }
  return out;
}

// Default factory — system clock + Math.random. Use this in production code paths.
export const defaultIds: IdFactory = createIdFactory();
