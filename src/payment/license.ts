export interface LicenseClaims {
  email: string
  activationLimit: number | null
  activationsUsed: number | null
}

export interface LicenseResult {
  valid: boolean
  claims?: LicenseClaims
  error?: string
}

export async function verifyLicense(licenseKey: string): Promise<LicenseResult> {
  try {
    const res = await fetch('/api/verify-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    })
    const data = await res.json() as LicenseResult
    return data
  } catch {
    return { valid: false, error: 'Could not reach license server' }
  }
}
