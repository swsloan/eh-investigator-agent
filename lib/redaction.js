const GENERIC_SECRET_PATTERN = /\b(EXTRAHOP_(?:API_KEY|CLIENT_ID|CLIENT_SECRET)|RL_API_TOKEN|REVERSINGLABS_API_TOKEN|BRAVE_SEARCH_API_KEY)\s*[:=]\s*(['"]?)[^\s'",;)}\]]+/gi;
// ReversingLabs authenticates with `Authorization: Token <token>`; scrub the
// header form too, in case it surfaces in a curl transcript or error.
const AUTHORIZATION_TOKEN_PATTERN = /\bAuthorization\s*:\s*Token\s+[^\s'",;)}\]]+/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function secretValues(secretStore) {
  if (!secretStore?.values) return [];
  return [...new Set(secretStore.values()
    .filter((value) => typeof value === 'string' && value.length >= 4))];
}

export function redactText(text, secretStore) {
  if (typeof text !== 'string' || !text) return text;
  let out = text
    .replace(GENERIC_SECRET_PATTERN, (_match, name) => `${name}=[REDACTED]`)
    .replace(AUTHORIZATION_TOKEN_PATTERN, 'Authorization: Token [REDACTED]');
  for (const value of secretValues(secretStore)) {
    out = out.replace(new RegExp(escapeRegExp(value), 'g'), '[REDACTED]');
  }
  return out;
}

export function redactValue(value, secretStore) {
  if (typeof value === 'string') return redactText(value, secretStore);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secretStore));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = redactValue(child, secretStore);
  }
  return out;
}

export function containsSecretMaterial(text, secretStore) {
  if (typeof text !== 'string' || !text) return false;
  GENERIC_SECRET_PATTERN.lastIndex = 0;
  if (GENERIC_SECRET_PATTERN.test(text)) return true;
  AUTHORIZATION_TOKEN_PATTERN.lastIndex = 0;
  if (AUTHORIZATION_TOKEN_PATTERN.test(text)) return true;
  return secretValues(secretStore).some((value) => text.includes(value));
}
