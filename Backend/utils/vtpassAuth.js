const isAuthenticationFailure = ({ status, data }) => {
  if ([401, 403].includes(Number(status)) || [401, 403].includes(Number(data?.code))) return true

  const message = typeof data === 'string'
    ? data
    : [data?.response_description, data?.message, data?.error, data?.content?.error].filter(Boolean).join(' ')

  return /invalid.{0,24}(credentials?|api.?key|secret.?key)|(?:credentials?|authentication).{0,24}(invalid|failed)|unauthori[sz]ed|forbidden/i.test(message)
}

const getProviderErrorMessage = (data, fallback) => (
  typeof data === 'string' && data.trim()
    ? data.trim()
    : data?.response_description || data?.message || data?.error || fallback
)

const getVtpassApiKey = () => (
  process.env.VTPASS_API_KEY?.trim() || process.env.vtpassPublicKey?.trim()
)

export const hasVtpassAuthConfig = () => Boolean(
  getVtpassApiKey() && process.env.VTPASS_SECRET_KEY?.trim(),
)

export const hasVtpassTvAuthConfig = () => Boolean(
  (process.env.VTPASS_USERNAME?.trim() && process.env.VTPASS_PASSWORD?.trim()) ||
  (getVtpassApiKey() && process.env.VTPASS_SECRET_KEY?.trim()),
);

const withVtpassCredentials = async (request, headers, authFailureMessage) => {
  try {
    const response = await request(headers)
    if (!isAuthenticationFailure({ status: response.status, data: response.data })) return response

    const error = new Error(
      `${getProviderErrorMessage(response.data, 'VTpass rejected the configured credentials.')} ${authFailureMessage}`,
    )
    error.statusCode = response.status === 401 || response.status === 403
      ? response.status
      : Number(response.data?.code) || 401
    error.response = response
    error.authFailure = true
    throw error
  } catch (error) {
    const data = error.response?.data
    if (error.authFailure || !isAuthenticationFailure({ status: error.response?.status, data })) throw error

    const authError = new Error(
      `${getProviderErrorMessage(data, error.message)} ${authFailureMessage}`,
      { cause: error },
    )
    authError.statusCode = error.response?.status || Number(data?.code) || 401
    authError.response = error.response
    authError.authFailure = true
    throw authError
  }
}

export const withVtpassAuth = async (request) => {
  const apiKey = getVtpassApiKey()
  const secretKey = process.env.VTPASS_SECRET_KEY?.trim()
  if (!apiKey || !secretKey) {
    const error = new Error('Configure VTPASS_API_KEY and VTPASS_SECRET_KEY on the backend.')
    error.statusCode = 503
    throw error
  }

  return withVtpassCredentials(request, {
    'api-key': apiKey,
    'secret-key': secretKey,
    'Content-Type': 'application/json',
  }, 'Confirm VTPASS_API_KEY and VTPASS_SECRET_KEY match VTPASS_BASE_URL.')
}

export const withVtpassTvAuth = async (request) => {
  const username = process.env.VTPASS_USERNAME?.trim()
  const password = process.env.VTPASS_PASSWORD?.trim()
  const apiKey = getVtpassApiKey()
  const secretKey = process.env.VTPASS_SECRET_KEY?.trim()
  const hasUsernamePassword = Boolean(username && password)
  const hasKeyPair = Boolean(apiKey && secretKey)

  if (!hasUsernamePassword && !hasKeyPair) {
    const error = new Error('Configure VTPASS_USERNAME and VTPASS_PASSWORD, or VTPASS_API_KEY and VTPASS_SECRET_KEY, on the backend for TV services.')
    error.statusCode = 503
    throw error
  }

  if (hasUsernamePassword) {
    try {
      return await withVtpassCredentials(request, {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      }, 'Confirm VTPASS_USERNAME and VTPASS_PASSWORD match VTPASS_BASE_URL.')
    } catch (error) {
      if (!error.authFailure) throw error
      if (!hasKeyPair) {
        error.message += ' API-key fallback is not configured; set VTPASS_API_KEY (or the legacy vtpassPublicKey) and VTPASS_SECRET_KEY.'
        throw error
      }
    }
  }

  try {
    return await withVtpassCredentials(request, {
      'api-key': apiKey,
      'secret-key': secretKey,
      'Content-Type': 'application/json',
    }, 'Confirm VTPASS_API_KEY and VTPASS_SECRET_KEY match VTPASS_BASE_URL.')
  } catch (error) {
    if (!error.authFailure || !hasUsernamePassword) throw error
    error.message += ' VTpass rejected both the configured username/password and API-key credentials.'
    throw error
  }
}
