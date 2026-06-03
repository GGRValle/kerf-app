/**
 * Lane 1 · Shell · Routing · Contracts — frozen interface version.
 * Downstream lanes (2–8) import from `@kerf/core` / `src/contracts/lane1`.
 * Bump only with explicit architecture review; do not churn ad hoc.
 *
 * Canon: D-053 · D-058 · D-059 · D-060 · D-061 · D-062 · D-051
 */
export const KERF_LANE1_SHELL_CONTRACT_VERSION = '2026-06-02.0' as const;

export type KerfLane1ShellContractVersion = typeof KERF_LANE1_SHELL_CONTRACT_VERSION;
