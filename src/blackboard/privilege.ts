// Privilege class helpers — LLM-gateway bypass surface.
//
// Architecture invariant (master doc §3.3 + §4.2 #3): events that carry a
// non-null `privilege_class` MUST be filtered out before any content is
// sent to a model. This is the "privileged-class bypass" layer of vendor
// protection — architectural, not policy.
//
// `@kerf/core` provides the primitive (the `privilege_class` field + the
// `isPrivilegedEvent` check). The actual filtering happens at the consumer's
// LLM gateway. Consumers MUST call `isPrivilegedEvent(event)` (or check the
// field directly) before assembling any model payload.

import type { Event } from './types.js';

/**
 * True if the event carries a privilege class that requires LLM-gateway
 * bypass. `null` means non-privileged and may be sent to a model (subject
 * to the consumer's other gates: data_class, permission matrix, etc.).
 *
 * Privilege class is distinct from related fields:
 *   - `data_class`           — privacy / PII / retention policy
 *   - `sensitive`            — permission-matrix filtering on read paths
 *   - `privilege_class`      — LLM-gateway bypass (this layer)
 *
 * The classes are independent; any combination is valid.
 */
export function isPrivilegedEvent(event: Event<unknown>): boolean {
  return event.privilege_class !== null;
}
