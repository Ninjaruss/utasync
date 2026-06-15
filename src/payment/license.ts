import { jwtVerify, importSPKI } from 'jose'

// Placeholder public key — replace with real LemonSqueezy key after setup
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPlaceholderKeyForDevelopmentOnly
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END PUBLIC KEY-----`

export interface LicenseClaims {
  sub: string
  orderId: string
  email: string
  iat: number
  exp: number
}

export interface LicenseResult {
  valid: boolean
  claims?: LicenseClaims
  error?: string
}

let cachedKey: CryptoKey | null = null

async function getPublicKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256')
  return cachedKey
}

export async function verifyLicense(token: string): Promise<LicenseResult> {
  try {
    let key: CryptoKey
    try {
      key = await getPublicKey()
    } catch {
      return { valid: false, error: 'Public key not configured' }
    }
    const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'] })
    return { valid: true, claims: payload as unknown as LicenseClaims }
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) }
  }
}
