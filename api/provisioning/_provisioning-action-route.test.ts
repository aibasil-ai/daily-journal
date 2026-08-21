import { describe, expect, test, vi } from 'vitest'
import {
  createProvisioningActionHandler,
  type ProvisioningActionRouteTable,
} from './[action].js'

describe('provisioning [action] route', () => {
  test('依路徑最後一段分派到對應 route module 的支援 method', async () => {
    const statusGet = vi.fn(async () => new Response(null, { status: 200 }))
    const createPost = vi.fn(async () => new Response(null, { status: 200 }))
    const routeTable: ProvisioningActionRouteTable = {
      status: { GET: statusGet },
      create: { POST: createPost },
    }
    const handle = createProvisioningActionHandler(routeTable)

    const statusResponse = await handle(new Request('https://journal.example/api/provisioning/status'))
    expect(statusResponse.status).toBe(200)
    expect(statusGet).toHaveBeenCalledOnce()
    expect(statusGet).toHaveBeenCalledWith(expect.any(Request))

    const createResponse = await handle(new Request('https://journal.example/api/provisioning/create', { method: 'POST' }))
    expect(createResponse.status).toBe(200)
    expect(createPost).toHaveBeenCalledOnce()
  })

  test('未知 action 回覆 404 JSON 錯誤，且不呼叫任何 handler', async () => {
    const statusGet = vi.fn(async () => new Response(null, { status: 200 }))
    const handle = createProvisioningActionHandler({ status: { GET: statusGet } })

    for (const path of [
      'https://journal.example/api/provisioning/unknown',
      'https://journal.example/api/provisioning',
      'https://journal.example/',
    ]) {
      const response = await handle(new Request(path))
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    }
    expect(statusGet).not.toHaveBeenCalled()
  })

  test('method 不支援時回覆 405 並標註允許的 method', async () => {
    const routeTable: ProvisioningActionRouteTable = {
      sheets: { GET: async () => new Response(null, { status: 200 }) },
      select: { POST: async () => new Response(null, { status: 200 }) },
    }
    const handle = createProvisioningActionHandler(routeTable)

    const wrongMethodOnSheets = await handle(new Request('https://journal.example/api/provisioning/sheets', { method: 'POST' }))
    expect(wrongMethodOnSheets.status).toBe(405)
    expect(wrongMethodOnSheets.headers.get('Allow')).toBe('GET')

    const wrongMethodOnSelect = await handle(new Request('https://journal.example/api/provisioning/select'))
    expect(wrongMethodOnSelect.status).toBe(405)
    expect(wrongMethodOnSelect.headers.get('Allow')).toBe('POST')

    const unsupportedVerb = await handle(new Request('https://journal.example/api/provisioning/select', { method: 'DELETE' }))
    expect(unsupportedVerb.status).toBe(405)
    expect(unsupportedVerb.headers.get('Allow')).toBe('POST')
  })

  test('路徑含結尾斜線或編碼字元仍可正確解析 action', async () => {
    const startChangePost = vi.fn(async () => new Response(null, { status: 200 }))
    const handle = createProvisioningActionHandler({ 'start-change': { POST: startChangePost } })

    const response = await handle(new Request('https://journal.example/api/provisioning/start-change/', { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(startChangePost).toHaveBeenCalledOnce()
  })
})
