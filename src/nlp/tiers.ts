// The LLM tiers, created once per app launch so their circuit breakers remember
// failures across photos (an offline cloud stays skipped when you open the next one).
import { createCloudPlanner } from './cloudPlanner';
import { onDevicePlanner } from './onDevicePlanner';
import { classifyCloudFailure, classifyOnDeviceFailure, withCircuitBreaker } from './resilience';
import type { Planner } from './types';

// Per-launch id so the planner worker can rate-limit per client.
const DEVICE_ID = `d-${Math.random().toString(36).slice(2, 12)}`;

export const llmTiers: Planner[] = [
  withCircuitBreaker(onDevicePlanner, classifyOnDeviceFailure),
  withCircuitBreaker(createCloudPlanner({ deviceId: DEVICE_ID }), classifyCloudFailure),
];
