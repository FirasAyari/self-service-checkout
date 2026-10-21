/* Generated from tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json. Do not edit. */
export type AnonymousTypeOfstring = {
  "status": null | string
}
export type CartLineRequest = {
  "itemId": string
  "quantity": number
  "optionIds"?: null | (string)[]
}
export type DemoCatalogPatchRequest = {
  "priceCents": number | null
  "stock": number | null
  "isActive": null | boolean
  "clearStock"?: boolean
}
export type DemoChaosMode = "Latency" | "DropResponse" | "CrashAfterReservation" | null
export type DemoChaosRequest = {
  "scenarioOverride": null | MockPaymentScenario
  "mode"?: null | DemoChaosMode
  "latencyMilliseconds"?: number
}
export type MenuCategoryDto = {
  "name": string
  "items": (MenuItemDto)[]
}
export type MenuItemDto = {
  "id": string
  "category": string
  "name": string
  "description": string
  "priceCents": number
  "stock": number | null
  "isAvailable": boolean
  "optionGroups": (MenuItemOptionGroupDto)[]
}
export type MenuItemOptionDto = {
  "id": string
  "name": string
  "additionalPriceCents": number
}
export type MenuItemOptionGroupDto = {
  "id": string
  "name": string
  "isRequired": boolean
  "maximumSelections": number
  "options": (MenuItemOptionDto)[]
}
export type MenuResponse = {
  "version": string
  "categories": (MenuCategoryDto)[]
}
export type MockPaymentScenario = "Approve" | "Decline" | "UnknownAfterApproval" | "StillUnknown"
export type OrderLineStatusDto = {
  "itemId": string
  "name": string
  "quantity": number
  "unitPriceCents": number
  "lineTotalCents": number
}
export type OrderStatusRequest = {
  "idempotencyKey": string
}
export type OrderStatusResponse = {
  "publicReference": string
  "status": string
  "pickupNumber": number | null
  "updatedAtUtc": string
  "message": string
  "lines": (OrderLineStatusDto)[]
  "totalCents": number
  "taxCents": number
  "currency": string
}
export type PlaceOrderRequest = {
  "quoteId": string
  "idempotencyKey": string
  "scenario": MockPaymentScenario
}
export type PlaceOrderResponse = {
  "order": OrderStatusResponse
}
export type ProblemDetails = {
  "type"?: null | string
  "title"?: null | string
  "status"?: number | null
  "detail"?: null | string
  "instance"?: null | string
}
export type QuoteLineDto = {
  "itemId": string
  "name": string
  "quantity": number
  "unitPriceCents": number
  "lineTotalCents": number
  "optionIds": (string)[]
}
export type QuoteRequest = {
  "items": null | (CartLineRequest)[]
}
export type QuoteResponse = {
  "quoteId": string
  "expiresAtUtc": string
  "lines": (QuoteLineDto)[]
  "totalCents": number
  "taxCents": number
  "currency": string
}
