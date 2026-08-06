import { clearSessionCookie } from '../_lib/cookies.js'
import { appendSetCookie } from '../_lib/function-response.js'

export async function POST(_request: Request): Promise<Response> {
  void _request
  return appendSetCookie(new Response(null, { status: 204 }), clearSessionCookie())
}
