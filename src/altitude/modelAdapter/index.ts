// Barrel export for the modelAdapter. Thread 1 ships the Groq Tier 1 client
// and the cost-math primitives; tenant context loading + AltitudePacket
// construction land in subsequent threads.

export {
  groqChat,
  defaultGroqClientDeps,
  HOSTING_ROUTE_REGISTRY_VERSION,
  type GroqChatRole,
  type GroqChatMessage,
  type GroqChatRequest,
  type GroqChatSuccess,
  type GroqChatFailure,
  type GroqChatFailureKind,
  type GroqChatResult,
  type GroqClientDeps,
} from './groqClient.js';

export {
  anthropicChat,
  defaultAnthropicClientDeps,
  type AnthropicChatRole,
  type AnthropicChatMessage,
  type AnthropicChatRequest,
  type AnthropicChatSuccess,
  type AnthropicChatFailure,
  type AnthropicChatFailureKind,
  type AnthropicChatResult,
  type AnthropicClientDeps,
} from './anthropicClient.js';

export {
  completionCostNanoUsd,
  nanoUsdToUsdString,
  GROQ_LLAMA_4_SCOUT_PRICING,
  ANTHROPIC_CLAUDE_SONNET_4_6_PRICING,
  type NanoUsd,
  type TokenPricingNanoUsdPerMillion,
} from './cost.js';
