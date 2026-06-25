import type { IncomingMessage, ServerResponse } from 'node:http'

const PAYHIP_PRODUCT_LINK = 'eun5b'
const PAYHIP_API_URL = 'https://payhip.com/api/v2/license/check'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString() })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ valid: false, error: 'Method not allowed' }))
    return
  }

  const secretKey = process.env.PAYHIP_SECRET_KEY
  if (!secretKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ valid: false, error: 'Service not configured' }))
    return
  }

  let licenseKey: string
  try {
    const raw = await readBody(req)
    const body = JSON.parse(raw) as { licenseKey?: unknown }
    if (typeof body.licenseKey !== 'string' || !body.licenseKey.trim()) {
      res.statusCode = 400
      res.end(JSON.stringify({ valid: false, error: 'License key is required' }))
      return
    }
    licenseKey = body.licenseKey.trim()
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ valid: false, error: 'Invalid request body' }))
    return
  }

  const params = new URLSearchParams({
    accessToken: secretKey,
    product_link: PAYHIP_PRODUCT_LINK,
    license_key: licenseKey,
  })

  let payhipRes: Response
  try {
    payhipRes = await fetch(PAYHIP_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ valid: false, error: 'License server unreachable' }))
    return
  }

  if (!payhipRes.ok) {
    res.statusCode = 502
    res.end(JSON.stringify({ valid: false, error: 'License verification failed' }))
    return
  }

  const data = await payhipRes.json() as Record<string, unknown>

  // Payhip returns { data: { enabled: true, ... } } on success or { message: "..." } on failure
  const licenseData = data.data as Record<string, unknown> | undefined
  if (!licenseData || licenseData.enabled !== true) {
    res.statusCode = 200
    res.end(JSON.stringify({ valid: false, error: 'License key not found or disabled' }))
    return
  }

  res.statusCode = 200
  res.end(JSON.stringify({
    valid: true,
    claims: {
      email: licenseData.buyer_email ?? '',
      activationLimit: licenseData.activation_limit ?? null,
      activationsUsed: licenseData.activations_used ?? null,
    },
  }))
}
