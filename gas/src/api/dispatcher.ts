import { executeJournalRequest, toApiError } from '../../../shared/journal/dispatcher'
import type { ApiRequest, ApiResponse } from '../../../shared/journal/types'
import { createJournalService } from '../setup'
import type { JournalService } from '../../../shared/journal/service'

export function executeAppRequest(
  request: ApiRequest,
  service?: JournalService,
): ApiResponse<unknown> {
  return executeJournalRequest(request, service ?? createJournalService())
}

export { toApiError }
