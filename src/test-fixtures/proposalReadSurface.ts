import {
  runPolicyGate,
  type DecisionPacket,
  type PolicyGateOptions,
} from '../altitude/index.js';
import { fixedClock } from '../shared/index.js';
import {
  detectProposalFollowupCandidates,
  draftProposalFollowup,
  proposalCandidateToAltitudePacket,
  type ProposalFollowupCandidate,
  type ProposalFollowupDraft,
  type ProposalFollowupFacts,
} from '../workflows/index.js';
import {
  driftDecisionPacketListFixture,
  invoiceDecisionPacketListFixture,
} from './decisionPackets.js';

export const SEEDED_PROPOSAL_READ_SURFACE_AS_OF = '2026-05-03T09:00:00.000Z';
export const SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT = '2026-05-03T09:15:00.000Z';

const SEEDED_PROPOSAL_READ_SURFACE_NOW_MS = Date.parse(SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT);

export interface SeededProposalReadSurfaceItem {
  candidate: ProposalFollowupCandidate;
  draft: ProposalFollowupDraft;
  decisionPacket: DecisionPacket;
}

export interface SeededProposalReadSurface {
  facts: ProposalFollowupFacts;
  items: readonly SeededProposalReadSurfaceItem[];
  decisionPackets: readonly DecisionPacket[];
}

export function createSeededProposalReadSurface(
  facts: ProposalFollowupFacts = seededProposalFollowupFacts,
): SeededProposalReadSurface {
  const candidates = detectProposalFollowupCandidates(facts, {
    clock: fixedClock(SEEDED_PROPOSAL_READ_SURFACE_AS_OF),
  });

  const items = candidates.map((candidate, index) => {
    const draft = draftProposalFollowup(candidate);
    const packet = proposalCandidateToAltitudePacket(candidate, draft, {
      tenantId: 'tenant_ggr',
      evaluatedAt: SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
      modelSourceId: 'seeded:proposal-read-surface',
      packetIdSuffix: ':seeded:pkt',
    });
    const decisionPacket = withFixedPolicyGateClock(() =>
      runPolicyGate(packet, seededPolicyGateOptions(candidate, index)),
    );

    return { candidate, draft, decisionPacket };
  });

  return {
    facts,
    items,
    decisionPackets: items.map((item) => item.decisionPacket),
  };
}

function seededPolicyGateOptions(
  candidate: ProposalFollowupCandidate,
  index: number,
): PolicyGateOptions {
  return {
    evaluatedAt: SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
    gateRunId: `gate_seeded_proposal_read_surface_${index}_${candidate.proposalId}`,
  };
}

function withFixedPolicyGateClock<T>(run: () => T): T {
  const originalNow = Date.now;
  Date.now = () => SEEDED_PROPOSAL_READ_SURFACE_NOW_MS;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

export const seededProposalFollowupFacts: ProposalFollowupFacts = {
  clients: [
    { id: 'client_ff_ada', name: 'Demo Client Ada', email: 'ada@example.com' },
    { id: 'client_ff_ben', name: 'Demo Client Ben', email: 'ben@example.com' },
    { id: 'client_ff_cleo', name: 'Demo Client Cleo', email: 'cleo@example.com' },
    { id: 'client_ff_diego', name: 'Demo Client Diego', email: 'diego@example.com' },
    { id: 'client_ff_elena', name: 'Demo Client Elena', email: 'elena@example.com' },
  ],
  projects: [
    { id: 'proj_ff_ada_kitchen', name: 'Ada Kitchen Refresh' },
    { id: 'proj_ff_ben_bath', name: 'Ben Bath Remodel' },
    { id: 'proj_ff_cleo_addition', name: 'Cleo ADU Planning' },
    { id: 'proj_ff_diego_deck', name: 'Diego Deck Rebuild' },
    { id: 'proj_ff_elena_laundry', name: 'Elena Laundry Room' },
  ],
  proposals: [
    {
      id: 'platform_proposal_ff_change_001',
      proposalNumber: 'PROP-FF-1001',
      status: 'viewed',
      totalCents: 2_850_000,
      sentAt: '2026-04-28T16:00:00.000Z',
      viewedAt: '2026-05-01T10:15:00.000Z',
      changeRequestedAt: '2026-05-02T15:30:00.000Z',
      clientId: 'client_ff_ada',
      projectId: 'proj_ff_ada_kitchen',
    },
    {
      id: 'platform_proposal_ff_expiry_002',
      proposalNumber: 'PROP-FF-1002',
      status: 'viewed',
      totalCents: 1_920_000,
      sentAt: '2026-04-24T14:00:00.000Z',
      viewedAt: '2026-04-26T11:45:00.000Z',
      expiresAt: '2026-05-05T23:59:00.000Z',
      clientId: 'client_ff_ben',
      projectId: 'proj_ff_ben_bath',
    },
    {
      id: 'platform_proposal_ff_viewed_003',
      proposalNumber: 'PROP-FF-1003',
      status: 'viewed',
      totalCents: 4_350_000,
      sentAt: '2026-04-23T17:30:00.000Z',
      viewedAt: '2026-04-29T09:10:00.000Z',
      clientId: 'client_ff_cleo',
      projectId: 'proj_ff_cleo_addition',
    },
    {
      id: 'platform_proposal_ff_unviewed_004',
      proposalNumber: 'PROP-FF-1004',
      status: 'sent',
      totalCents: 975_000,
      sentAt: '2026-04-29T13:00:00.000Z',
      viewedAt: null,
      clientId: 'client_ff_diego',
      projectId: 'proj_ff_diego_deck',
    },
    {
      id: 'platform_proposal_ff_accepted_005',
      proposalNumber: 'PROP-FF-1005',
      status: 'accepted',
      totalCents: 1_175_000,
      sentAt: '2026-04-30T12:00:00.000Z',
      viewedAt: '2026-05-01T08:45:00.000Z',
      clientId: 'client_ff_elena',
      projectId: 'proj_ff_elena_laundry',
    },
  ],
};

export const seededProposalReadSurface = createSeededProposalReadSurface();

export const seededProposalDecisionPacketListFixture =
  seededProposalReadSurface.decisionPackets;

export const seededMixedDecisionPacketListFixture = [
  ...invoiceDecisionPacketListFixture,
  ...seededProposalDecisionPacketListFixture,
  ...driftDecisionPacketListFixture,
];
