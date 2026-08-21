export type {
  ApiRequest,
  ApiResponse,
  BootstrapData,
  Category,
  CategoryInput,
  CategoryManagementData,
  CsvExportData,
  DailyEntries,
  DailyEntryCount,
  Entry,
  EntryFilter,
  EntryFilterCriteria,
  EntryInput,
  EntryListData,
  JournalLink,
  MoveEntriesInput,
  MoveEntriesResult,
} from '../../shared/journal/types'

import type { EntryFilter, EntryFilterCriteria } from '../../shared/journal/types'

export const DEFAULT_ENTRY_FILTER: EntryFilter = {
  query: '',
  from: null,
  to: null,
  categoryId: null,
  tag: null,
  cursor: null,
  limit: 20,
}

export function toFilterCriteria(filter: EntryFilter): EntryFilterCriteria {
  return {
    query: filter.query,
    from: filter.from,
    to: filter.to,
    categoryId: filter.categoryId,
    tag: filter.tag,
  }
}
