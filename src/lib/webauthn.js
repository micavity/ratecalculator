// Passkeys (WebAuthn) for manager sign-in, using only the Web Crypto API.
// We ask for no attestation, so a new passkey is trusted the way a new
// password would be; what matters is that each later sign-in is signed by
// the private key that stayed on the manager's device.

export function toBase64Url(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function randomChallenge() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Bytes(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// A small CBOR reader: enough for attestation objects and public keys
export function decodeCbor(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  function length(info) {
    if (info < 24) return info;
    if (info === 24) return view.getUint8(pos++);
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(view.getBigUint64(pos)); pos += 8; return v; }
    throw new Error('Unsupported CBOR length');
  }
  function item() {
    const first = view.getUint8(pos++);
    const major = first >> 5;
    const info = first & 31;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: { const n = length(info); const v = bytes.slice(pos, pos + n); pos += n; return v; }
      case 3: { const n = length(info); const v = new TextDecoder().decode(bytes.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const n = length(info); const list = []; for (let i = 0; i < n; i++) list.push(item()); return list; }
      case 5: { const n = length(info); const map = new Map(); for (let i = 0; i < n; i++) { const k = item(); map.set(k, item()); } return map; }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('Unsupported CBOR value');
      default: throw new Error('Unsupported CBOR type');
    }
  }
  const value = item();
  return { value, length: pos };
}

// COSE public key → JWK that Web Crypto can import
function coseToJwk(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: toBase64Url(cose.get(-2)), y: toBase64Url(cose.get(-3)), ext: true } };
  }
  if (kty === 3 && alg === -257) {
    return { alg: -257, jwk: { kty: 'RSA', alg: 'RS256', n: toBase64Url(cose.get(-1)), e: toBase64Url(cose.get(-2)), ext: true } };
  }
  throw new Error('This passkey uses a key type we don\'t support yet.');
}

function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('Passkey data is too short.');
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const flags = authData[32];
  const result = {
    rpIdHash: authData.slice(0, 32),
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    signCount: view.getUint32(33),
  };
  if (flags & 0x40) {
    const idLength = view.getUint16(53);
    result.credentialId = authData.slice(55, 55 + idLength);
    result.publicKey = decodeCbor(authData.slice(55 + idLength)).value;
  }
  return result;
}

function checkClientData(clientDataJSON, type, challenge, origin) {
  const data = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (data.type !== type) throw new Error('Wrong passkey request type.');
  if (data.challenge !== challenge) throw new Error('This passkey request expired. Please try again.');
  if (data.origin !== origin) throw new Error('This passkey was made for a different website.');
}

async function checkRp(authData, rpId) {
  if (!equalBytes(authData.rpIdHash, await sha256Bytes(new TextEncoder().encode(rpId)))) {
    throw new Error('This passkey was made for a different website.');
  }
  if (!authData.userPresent) throw new Error('The passkey wasn\'t confirmed on the device.');
}

/**
 * Checks a new passkey. Returns { credentialId, publicKey (JWK JSON), alg, signCount }.
 * response: { clientDataJSON, attestationObject } as base64url strings.
 */
export async function verifyRegistration(response, { challenge, origin, rpId }) {
  const clientDataJSON = fromBase64Url(response.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.create', challenge, origin);
  const attestation = decodeCbor(fromBase64Url(response.attestationObject)).value;
  const authData = parseAuthData(attestation.get('authData'));
  await checkRp(authData, rpId);
  if (!authData.credentialId || !authData.publicKey) throw new Error('The passkey didn\'t include its key.');
  const { alg, jwk } = coseToJwk(authData.publicKey);
  // Make sure the key really works with Web Crypto before saving it
  await importKey(jwk, alg);
  return { credentialId: toBase64Url(authData.credentialId), publicKey: JSON.stringify(jwk), alg, signCount: authData.signCount };
}

function importKey(jwk, alg) {
  return alg === -7
    ? crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// ECDSA signatures arrive DER-encoded; Web Crypto wants raw r || s
function derToRaw(der) {
  let pos = 2;
  if (der[1] & 0x80) pos += der[1] & 0x7f;
  const read = () => {
    if (der[pos] !== 0x02) throw new Error('Bad signature');
    const n = der[pos + 1];
    let int = der.slice(pos + 2, pos + 2 + n);
    pos += 2 + n;
    while (int.length > 32 && int[0] === 0) int = int.slice(1);
    const out = new Uint8Array(32);
    out.set(int, 32 - int.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

/**
 * Checks a passkey sign-in against the stored key. Returns the new sign count.
 * response: { clientDataJSON, authenticatorData, signature } as base64url strings.
 */
export async function verifyAuthentication(response, stored, { challenge, origin, rpId }) {
  const clientDataJSON = fromBase64Url(response.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.get', challenge, origin);
  const authDataBytes = fromBase64Url(response.authenticatorData);
  const authData = parseAuthData(authDataBytes);
  await checkRp(authData, rpId);

  const signed = new Uint8Array(authDataBytes.length + 32);
  signed.set(authDataBytes);
  signed.set(await sha256Bytes(clientDataJSON), authDataBytes.length);
  const key = await importKey(JSON.parse(stored.public_key), stored.alg);
  let signature = fromBase64Url(response.signature);
  if (stored.alg === -7) signature = derToRaw(signature);
  const algorithm = stored.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  if (!(await crypto.subtle.verify(algorithm, key, signature, signed))) throw new Error('The passkey signature didn\'t match.');

  // A counter that goes backwards suggests a copied key
  if (authData.signCount && stored.sign_count && authData.signCount <= stored.sign_count) {
    throw new Error('This passkey looks like a copy. Please sign in on your own device.');
  }
  return authData.signCount;
}
