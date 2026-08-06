import { clearSessionCookie } from '../_lib/cookies'
import { appendSetCookie } from '../_lib/function-response'

export async function POST(_request: Request): Promise<Response> {
  void _request
  return appendSetCookie(new Response(null, { status: 204 }), clearSessionCookie())
}
