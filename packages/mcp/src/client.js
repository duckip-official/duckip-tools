export class ApiError extends Error {
  constructor(message, code, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function authFailureHint(spec) {
  if (spec.auth === 'app') {
    return ` App Key authentication was rejected by ${spec.path}. This request uses app_key, not a login session. Check the personal-center App Key and API origin; this response alone cannot distinguish an invalid key from a server authentication mismatch.`;
  }
  if (spec.auth === 'token') return ' Login token expired or invalid. Run duckip auth login again.';
  return ' Login authentication failed; check credentials and any required verification.';
}

export function maskSecrets(value, secrets = []) {
  if (Array.isArray(value)) return value.map((entry) => maskSecrets(entry, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /password|passwd|token|app_?key|openid|secret|verify_code|authorization/i.test(key) ? '[REDACTED]' :
        key === 'accounts' && typeof item === 'string' && item.includes(':') ? item.replace(/:[^,]+/g, ':[REDACTED]') : maskSecrets(item, secrets),
    ]));
  }
  if (typeof value === 'string') {
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      value = value.replaceAll(secret, '[REDACTED]').replaceAll(encodeURIComponent(secret), '[REDACTED]');
    }
    value = value.replace(/([?&](?:app_key|access_token|token)=)[^&\s]*/gi, '$1[REDACTED]');
  }
  return value;
}

export function createClient({ baseUrl = 'https://api.duckip.cn', credentials = {}, timeout = 20000, language = 'zh', fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw new Error('API URL must use HTTPS (HTTP is allowed only for localhost tests)');
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('API URL must be an origin without path, query, or credentials');
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300000) throw new Error('Timeout must be 1-300000 ms');

  function prepare(spec, params, allowMissing = false) {
    const data = { ...params, language };
    const headers = { Accept: 'application/json', Language: language, 'User-Agent': 'duckip-cli/0.1.0' };
    if (spec.auth === 'app') {
      if (!credentials.appKey && !allowMissing) throw new Error('App key required. Run duckip auth key or duckip auth login, or set DUCKIP_APP_KEY.');
      data.app_key = credentials.appKey || '<DUCKIP_APP_KEY>';
    } else if (spec.auth === 'token') {
      if (!credentials.token && !allowMissing) throw new Error('Login token required. Run duckip auth login or set DUCKIP_TOKEN.');
      headers.Authorization = `Bearer ${credentials.token || '<DUCKIP_TOKEN>'}`;
    }
    if (spec.path.startsWith('/web_v1/') && credentials.deviceId) headers.hash = credentials.deviceId;
    const url = new URL(spec.path, base);
    let body;
    if (spec.method === 'GET') {
      for (const [key, value] of Object.entries(data)) url.searchParams.set(key, String(value));
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(data);
    }
    return { url, headers, body };
  }

  return {
    preview(spec, params) {
      const request = prepare(spec, params, true);
      return maskSecrets({ method: spec.method, url: request.url.toString(), headers: request.headers, body: request.body ? JSON.parse(request.body) : undefined }, [credentials.appKey, credentials.token]);
    },
    async request(spec, params = {}) {
      const request = prepare(spec, params);
      let response;
      let text;
      try {
        response = await fetchImpl(request.url, {
          method: spec.method, headers: request.headers, body: request.body,
          redirect: 'error', signal: AbortSignal.timeout(timeout),
        });
        text = await response.text();
      } catch (error) {
        const cause = error.name === 'TimeoutError' ? 'Request timed out' : 'Network request failed';
        throw new ApiError(`${cause}. No automatic retry was made. For orders/payments, check order status before retrying.`, 'NETWORK');
      }
      let payload;
      try { payload = JSON.parse(text); } catch {
        if (response.ok && spec.action === 'extract' && params.format === 'text' && !/^\s*</.test(text) && /^(text\/plain|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) return text;
        throw new ApiError(`API returned non-JSON data (HTTP ${response.status})`, 'INVALID_RESPONSE');
      }
      if (!response.ok) {
        const hint = payload?.code === 3 || response.status === 401 ? authFailureHint(spec) : '';
        throw new ApiError(`HTTP ${response.status}: ${payload?.message || payload?.msg || 'Request failed'}${hint}`, payload?.code ?? response.status);
      }
      const success = payload && (payload.code === 200 || (spec.zeroSuccess && payload.code === 0));
      if (!success) {
        let message = payload?.message || payload?.msg || 'Unrecognized API response';
        if (payload?.code === 3) message += authFailureHint(spec);
        if (payload?.code === 348) message += ' MFA required; repeat login with --verify-type and --verify-code.';
        if ([286, 287].includes(payload?.code)) message += ' Complete phone verification in the dashboard, or provide the required verification code.';
        throw new ApiError(message, payload?.code ?? 'INVALID_RESPONSE', payload?.data);
      }
      return payload;
    },
  };
}
