/** 依 IANA 時區產生含 UTC offset 的 ISO 8601 時間字串。 */
export function formatZonedTimestamp(date: Date, timeZone: string): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('日期無效。')

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const offset = normalizeOffset(values.timeZoneName)
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}.${milliseconds}${offset}`
}

function normalizeOffset(value: string | undefined): string {
  if (value === 'GMT' || value === 'UTC') return '+00:00'
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value ?? '')
  if (!match) throw new RangeError('無法取得時區 offset。')
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`
}
