export function jsonResponse(body: unknown, status: number = 200, cookies: string[] = []): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: createHeaders('application/json; charset=utf-8', cookies),
  })
}

export function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = createHeaders(undefined, cookies)
  headers.set('Location', location)
  return new Response(null, { status: 302, headers })
}

export function emptyResponse(status: number, cookies: string[] = []): Response {
  return new Response(null, { status, headers: createHeaders(undefined, cookies) })
}

export function methodNotAllowed(allowedMethod: string): Response {
  const headers = createHeaders()
  headers.set('Allow', allowedMethod)
  return new Response(null, { status: 405, headers })
}

function createHeaders(contentType?: string, cookies: string[] = []): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (contentType) headers.set('Content-Type', contentType)
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return headers
}
