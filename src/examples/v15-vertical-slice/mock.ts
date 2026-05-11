/**
 * Demo-only placeholders for vertical-slice navigation.
 *
 * Canonical UI types + mocks live in `src/demo/` (Agent 7). Prefer:
 *   `import { mockDecisionPacketApprovalRequired, … } from '../../demo/verticalSliceMockData.js'`
 * for new surfaces; keep these opaque ids until routes migrate.
 */
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../../demo/verticalSliceFlowIds.js';

/** Same id for decision surface routes and audit deep-links (one spine packet). */
export const DEMO_DECISION_ID = VERTICAL_SLICE_FLOW_PACKET_ID;
export const DEMO_PACKET_ID = VERTICAL_SLICE_FLOW_PACKET_ID;
