export function dateInTimeZone(timeZone: string | undefined, date = new Date()): string {
  return formatParts(timeZone, date, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function monthInTimeZone(timeZone: string | undefined, date = new Date()): string {
  return formatParts(timeZone, date, { year: 'numeric', month: '2-digit' })
}

function formatParts(
  timeZone: string | undefined,
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  const parts = new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  const year = values.get('year')!
  const month = values.get('month')!

  return options.day ? `${year}-${month}-${values.get('day')!}` : `${year}-${month}`
}
