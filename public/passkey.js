// Passkey helpers for manager sign-in. The server sends options with
// base64url strings; the browser's passkey API wants raw bytes.

function toBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function toText(buffer) {
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

export function passkeysSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

function friendly(err) {
  if (err?.name === 'NotAllowedError') return new Error('The passkey request was cancelled or timed out. Please try again.');
  if (err?.name === 'InvalidStateError') return new Error('This device already has a passkey for this account.');
  return err;
}

// Makes a passkey: from an invite ({ token, name }), or for another device ({})
export async function createPasskey(body = {}) {
  if (!passkeysSupported()) throw new Error("This browser doesn't support passkeys. Try an up-to-date Chrome, Safari, Edge or Firefox.");
  const { challengeId, publicKey } = await post('/api/passkeys/register/options', body);
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        ...publicKey,
        challenge: toBytes(publicKey.challenge),
        user: { ...publicKey.user, id: toBytes(publicKey.user.id) },
        excludeCredentials: publicKey.excludeCredentials.map((c) => ({ ...c, id: toBytes(c.id) })),
      },
    });
  } catch (err) {
    throw friendly(err);
  }
  return post('/api/passkeys/register/verify', {
    challengeId,
    response: {
      clientDataJSON: toText(credential.response.clientDataJSON),
      attestationObject: toText(credential.response.attestationObject),
    },
  });
}

export async function signInWithPasskey() {
  if (!passkeysSupported()) throw new Error("This browser doesn't support passkeys. Try an up-to-date Chrome, Safari, Edge or Firefox.");
  const { challengeId, publicKey } = await post('/api/passkeys/login/options', {});
  let credential;
  try {
    credential = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: toBytes(publicKey.challenge) } });
  } catch (err) {
    throw friendly(err);
  }
  return post('/api/passkeys/login/verify', {
    challengeId,
    id: credential.id,
    response: {
      clientDataJSON: toText(credential.response.clientDataJSON),
      authenticatorData: toText(credential.response.authenticatorData),
      signature: toText(credential.response.signature),
    },
  });
}
