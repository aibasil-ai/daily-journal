import { executeJournalRequest, toApiError } from '../../../shared/journal/dispatcher'
import type { ApiRequest, ApiResponse } from '../../../shared/journal/types'
import type { JournalService } from '../../../shared/journal/service'
import { createJournalService } from '../setup'

/** GAS Execution API 的相容分派入口。 */
export function executeAppRequest(
  request: ApiRequest,
  service?: JournalService,
): ApiResponse<unknown> {
  return executeJournalRequest(request, service ?? createJournalService)
}

export { toApiError }
