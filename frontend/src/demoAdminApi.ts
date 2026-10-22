import type {
  DemoCatalogItemDto,
  DemoCatalogPatchRequest,
  DemoChaosMode,
  DemoChaosRequest,
  DemoChaosStateDto,
  MockPaymentScenario,
} from './api.generated'
import { request } from './api'

export type DemoCatalogItem = DemoCatalogItemDto
export type DemoChaosState = DemoChaosStateDto

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isDemoCatalogItem(value: unknown): value is DemoCatalogItem {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.category) &&
    isNonEmptyString(value.name) && typeof value.description === 'string' &&
    isPositiveSafeInteger(value.priceCents) &&
    (value.stock === null || isNonNegativeSafeInteger(value.stock)) &&
    typeof value.isActive === 'boolean' && isNonNegativeSafeInteger(value.sortOrder)
}

function isDemoCatalog(value: unknown): value is DemoCatalogItem[] {
  return Array.isArray(value) && value.every(isDemoCatalogItem)
}

function isMockScenario(value: unknown): value is MockPaymentScenario | null {
  return value === null || value === 'Approve' || value === 'Decline' ||
    value === 'UnknownAfterApproval' || value === 'StillUnknown'
}

function isChaosMode(value: unknown): value is DemoChaosMode | null {
  return value === null || value === 'Latency' || value === 'DropResponse' || value === 'CrashAfterReservation'
}

function isDemoChaosState(value: unknown): value is DemoChaosState {
  return isRecord(value) && isMockScenario(value.scenarioOverride) && isChaosMode(value.mode) &&
    isNonNegativeSafeInteger(value.latencyMilliseconds) && value.latencyMilliseconds <= 7_000
}

export const demoAdminApi = {
  items: (token: string) => request('/api/admin/items', {
    method: 'GET', headers: { 'X-Admin-Token': token },
  }, isDemoCatalog),
  chaos: (token: string) => request('/api/admin/chaos', {
    method: 'GET', headers: { 'X-Admin-Token': token },
  }, isDemoChaosState),
  updateItem: (token: string, itemId: string, patch: DemoCatalogPatchRequest) => request('/api/admin/items/' + encodeURIComponent(itemId), {
    method: 'PATCH', headers: { 'X-Admin-Token': token }, body: JSON.stringify(patch),
  }, (value): value is null => value === null),
  updateChaos: (token: string, configuration: DemoChaosRequest) => request('/api/admin/chaos', {
    method: 'POST', headers: { 'X-Admin-Token': token }, body: JSON.stringify(configuration),
  }, isDemoChaosState),
  reset: (token: string) => request('/api/admin/reset', {
    method: 'POST', headers: { 'X-Admin-Token': token },
  }, (value): value is null => value === null),
}
