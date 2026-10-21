import type { Scenario } from './api'

const demoEnabledModes = new Set(['development', 'test', 'e2e'])

export function isDemoOutcomeSelectionEnabled(mode: string): boolean {
  return demoEnabledModes.has(mode)
}

export function getEffectivePaymentScenario(mode: string, selectedScenario: Scenario): Scenario {
  return isDemoOutcomeSelectionEnabled(mode) ? selectedScenario : 'Approve'
}
