export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

export function appendSetCookie(response: Response, cookie: string): Response {
  response.headers.append('Set-Cookie', cookie)
  return response
}
