import { JournalError, isJournalError } from './errors.js'
import type { ApiRequest, ApiResponse } from './types.js'
import {
  parseCategoryInput,
  parseCategoryColor,
  parseEntryFilter,
  parseEntryFilterCriteria,
  parseEntryInput,
  parseMoveEntriesInput,
} from './validation.js'
import type { JournalService } from './service.js'

type UnknownRequest = Record<string, unknown>
type JournalServiceProvider = JournalService | (() => JournalService)

/** 與傳輸層無關的 API 請求分派器。 */
export function executeJournalRequest(
  request: unknown,
  service: JournalServiceProvider,
): ApiResponse<unknown> {
  if (!isRequest(request)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '請檢查送出的資料格式後再試。' }
  }
  if (!isSupportedAction(request.action)) {
    return { ok: false, code: 'INVALID_ACTION', message: '不支援的操作。' }
  }

  const getService = typeof service === 'function' ? service : () => service

  try {
    switch (request.action) {
      case 'bootstrap':
        return { ok: true, data: getService().bootstrap() }
      case 'listCategories':
        return { ok: true, data: getService().listCategories() }
      case 'listEntries': {
        const filter = parseEntryFilter(request.filter)
        return { ok: true, data: getService().listEntries(filter) }
      }
      case 'getEntriesForDate': {
        const date = readString(request, 'date')
        const filter = parseEntryFilterCriteria(request.filter)
        return {
          ok: true,
          data: getService().getEntriesForDate(date, filter),
        }
      }
      case 'getMonthlyEntryCounts': {
        const year = readNumber(request, 'year')
        const month = readNumber(request, 'month')
        const filter = parseEntryFilterCriteria(request.filter)
        return {
          ok: true,
          data: getService().getMonthlyEntryCounts(year, month, filter),
        }
      }
      case 'getMonthlyEntries': {
        const year = readNumber(request, 'year')
        const month = readNumber(request, 'month')
        const filter = parseEntryFilterCriteria(request.filter)
        return {
          ok: true,
          data: getService().getMonthlyEntries(year, month, filter),
        }
      }
      case 'saveEntry': {
        const entry = parseEntryInput(request.entry)
        return { ok: true, data: getService().saveEntry(entry) }
      }
      case 'deleteEntry': {
        const id = readString(request, 'id')
        getService().deleteEntry(id)
        return { ok: true, data: null }
      }
      case 'saveCategory': {
        const category = parseCategoryInput(request.category)
        return { ok: true, data: getService().saveCategory(category) }
      }
      case 'setCategoryColor': {
        const id = readString(request, 'id')
        const color = parseCategoryColor(request.color)
        return { ok: true, data: getService().setCategoryColor(id, color) }
      }
      case 'deactivateCategory': {
        const id = readString(request, 'id')
        return { ok: true, data: getService().deactivateCategory(id) }
      }
      case 'activateCategory': {
        const id = readString(request, 'id')
        return { ok: true, data: getService().activateCategory(id) }
      }
      case 'moveEntries': {
        const input = parseMoveEntriesInput(request)
        return { ok: true, data: getService().moveEntries(input) }
      }
      case 'deleteCategory': {
        const id = readString(request, 'id')
        getService().deleteCategory(id)
        return { ok: true, data: null }
      }
      case 'exportEntries': {
        const filter = parseEntryFilterCriteria(request.filter)
        return { ok: true, data: getService().exportEntries(filter) }
      }
      default:
        return { ok: false, code: 'INVALID_ACTION', message: '不支援的操作。' }
    }
  } catch (error) {
    return toApiError(error)
  }
}

export function toApiError(error: unknown): ApiResponse<never> {
  if (isJournalError(error)) {
    return { ok: false, code: error.code, message: error.message }
  }

  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: '處理資料時發生錯誤，請稍後再試。',
  }
}

export function isJournalMutation(request: unknown): boolean {
  if (!isRequest(request)) return false
  return request.action === 'saveEntry'
    || request.action === 'deleteEntry'
    || request.action === 'saveCategory'
    || request.action === 'setCategoryColor'
    || request.action === 'deactivateCategory'
    || request.action === 'activateCategory'
    || request.action === 'moveEntries'
    || request.action === 'deleteCategory'
}

function isRequest(value: unknown): value is UnknownRequest & { action: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as UnknownRequest).action === 'string'
}

function isSupportedAction(action: string): action is ApiRequest['action'] {
  return action === 'bootstrap'
    || action === 'listCategories'
    || action === 'listEntries'
    || action === 'getEntriesForDate'
    || action === 'getMonthlyEntryCounts'
    || action === 'getMonthlyEntries'
    || action === 'saveEntry'
    || action === 'deleteEntry'
    || action === 'saveCategory'
    || action === 'setCategoryColor'
    || action === 'deactivateCategory'
    || action === 'activateCategory'
    || action === 'moveEntries'
    || action === 'deleteCategory'
    || action === 'exportEntries'
}

function readString(request: UnknownRequest, key: string): string {
  if (typeof request[key] !== 'string') {
    throwInvalidRequest()
  }
  return request[key] as string
}

function readNumber(request: UnknownRequest, key: string): number {
  if (typeof request[key] !== 'number' || !Number.isFinite(request[key])) {
    throwInvalidRequest()
  }
  return request[key] as number
}

function throwInvalidRequest(): never {
  throw new JournalError('INVALID_REQUEST', '請檢查送出的資料格式後再試。')
}
