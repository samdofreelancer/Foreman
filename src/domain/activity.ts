export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type ActivityMetadata = Readonly<Record<string, JsonValue>>

export type ActivityEvent = Readonly<{
  id: string
  type: string
  summary: string
  taskId?: string
  projectId?: string
  metadata: ActivityMetadata
  occurredAt: number
}>

export type ActivityInput = {
  type: string
  summary: string
  taskId?: string
  projectId?: string
  metadata?: Record<string, unknown>
}

const forbiddenMetadataKey = /(secret|token|password|transcript|prompt|authorization|credential|api.?key)/i

export function validateActivityInput(input: ActivityInput) {
  const summary = input.summary.trim()
  const errors: string[] = []
  if (!input.type.trim() || input.type.length > 100) errors.push("Activity type is required and must be 100 characters or fewer")
  if (!summary || summary.length > 500) errors.push("Activity summary is required and must be 500 characters or fewer")
  if (input.metadata !== undefined && !isSafeMetadata(input.metadata)) {
    errors.push("Activity metadata must be safe, JSON-compatible structured data without secrets or transcript content")
  }
  return { valid: errors.length === 0, errors }
}

export function createActivityEvent(input: ActivityInput, now: number, id: string): ActivityEvent {
  const validation = validateActivityInput(input)
  if (!validation.valid) throw new Error(validation.errors[0])
  if (!id.trim()) throw new Error("Activity id is required")
  if (!Number.isFinite(now) || now < 0) throw new Error("Activity timestamp must be a non-negative finite number")
  return {
    id,
    type: input.type.trim(),
    summary: input.summary.trim(),
    taskId: input.taskId,
    projectId: input.projectId,
    metadata: structuredClone((input.metadata ?? {}) as ActivityMetadata),
    occurredAt: now,
  }
}

function isSafeMetadata(value: unknown, depth = 0): value is Record<string, JsonValue> {
  if (depth > 3 || !isRecord(value)) return false
  const entries = Object.entries(value)
  if (entries.length > 50) return false
  return entries.every(([key, item]) => {
    if (!key.trim() || forbiddenMetadataKey.test(key)) return false
    if (item === null || typeof item === "string" || typeof item === "boolean") return true
    if (typeof item === "number") return Number.isFinite(item)
    if (Array.isArray(item)) return item.length <= 50 && item.every((entry) => isJsonValue(entry, depth + 1))
    return isRecord(item) && isSafeMetadata(item, depth + 1)
  })
}

function isJsonValue(value: unknown, depth: number): value is JsonValue {
  if (depth > 3) return false
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 50 && value.every((entry) => isJsonValue(entry, depth + 1))
  return isRecord(value) && isSafeMetadata(value, depth + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
