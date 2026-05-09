import {
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from '../test-fixtures/index.js';

/**
 * Single `DecisionPacket.packet_id` for the F-33→F-37 vertical-slice demo spine.
 * Matches the policy-gated proposal fixture so F-37 `resolveF37Packet` and v15
 * `/decisions/*` + `/audit/*` links stay coherent.
 */
export const VERTICAL_SLICE_FLOW_PACKET_ID = proposalDecisionPacketFixture.packet_id;

/**
 * Secondary demo packet id (invoice follow-up) — resolvable in F-37 for contrast
 * flows (e.g. blocked-pricing audit row) without colliding with the spine id.
 */
export const VERTICAL_SLICE_FLOW_ALT_PACKET_ID = invoiceDecisionPacketFixture.packet_id;
