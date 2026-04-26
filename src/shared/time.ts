import type { ISO8601 } from '../blackboard/types';

// Time primitives. Every module that needs "now" goes through a Clock instead
// of reaching for `new Date()` directly. Tests inject fixedClock.

export interface Clock {
  now(): Date;
  iso(): ISO8601;
}

export function systemClock(): Clock {
  return {
    now: () => new Date(),
    iso: () => new Date().toISOString(),
  };
}

// Frozen clock — returns the same instant every call. For deterministic tests.
export function fixedClock(at: Date | string): Clock {
  const d = typeof at === 'string' ? new Date(at) : new Date(at.getTime());
  return {
    now: () => new Date(d.getTime()),
    iso: () => d.toISOString(),
  };
}

export function toIso(d: Date | number | string): ISO8601 {
  if (typeof d === 'string') return new Date(d).toISOString();
  if (typeof d === 'number') return new Date(d).toISOString();
  return d.toISOString();
}

export const MS_SECOND = 1000;
export const MS_MINUTE = 60 * MS_SECOND;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;
