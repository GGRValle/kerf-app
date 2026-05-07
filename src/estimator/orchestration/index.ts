// Barrel export for the Estimator orchestration layer.
//
// Trust-discipline architecture: prompt = belt; parser + packetBuilder =
// suspenders. The LLM proposes; Kerf disposes. See `responseParser.ts` and
// `packetBuilder.ts` for the load-bearing enforcement code.

export {
  estimateProject,
  EstimatorOrchestrationError,
  type EstimateProjectResult,
} from './estimateProject.js';

export {
  makeGroqModelCaller,
  type MakeGroqModelCallerOpts,
} from './groqModelCaller.js';

export {
  buildEstimatorPrompt,
  type BuildPromptOpts,
  type BuiltPrompt,
} from './promptBuilder.js';

export {
  parseRawResponse,
  enforceTrustDiscipline,
  ResponseParseError,
  type EnforceTrustDisciplineInput,
} from './responseParser.js';

export {
  buildEstimatorAltitudePacket,
  PacketBuildViolationError,
  type BuildPacketOpts,
} from './packetBuilder.js';

export {
  type EstimatorDeps,
  type EstimatorGap,
  type EstimatorInputs,
  type EstimatorLineItem,
  type EstimatorResponse,
  type ModelCaller,
  type ModelCallerInput,
  type ModelCallerResult,
  type ModelCallerSuccess,
  type ModelCallerFailure,
  type RawEstimatorResponse,
  type RawGap,
  type RawLineItem,
} from './types.js';
