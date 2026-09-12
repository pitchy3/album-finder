const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|encrypted[_-]?token)/i;

function redactString(value, secrets = []) {
  let redacted = String(value);

  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }

  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(access_token|refresh_token|id_token|client_secret)\b(\s*[=:]\s*|%3D)[^\s&,;]+/gi,
      (_match, key) => `${key}=${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
}

function sanitizeValue(value, secrets = [], seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value, secrets);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeValue(nestedValue, secrets, seen);
  }
  return output;
}

function safeUrl(value, secrets = []) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    return redactString(url.toString(), secrets);
  } catch {
    return redactString(value, secrets);
  }
}

function errorDetails(error, secrets = []) {
  let errorCause = null;
  if (error?.cause instanceof Error) {
    errorCause = {
      name: redactString(error.cause.name, secrets),
      message: redactString(error.cause.message, secrets),
      code: error.cause.code == null ? null : redactString(error.cause.code, secrets),
      stack: error.cause.stack == null ? null : redactString(error.cause.stack, secrets)
    };
  } else if (error?.cause != null) {
    errorCause = sanitizeValue(error.cause, secrets);
  }

  return {
    errorName: redactString(error?.name || 'Error', secrets),
    errorMessage: redactString(error?.message || String(error), secrets),
    errorCode: error?.code == null ? null : redactString(error.code, secrets),
    errorCause,
    stack: error?.stack == null ? null : redactString(error.stack, secrets)
  };
}

module.exports = { errorDetails, safeUrl };
