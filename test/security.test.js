import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = 'x'.repeat(40);

const { encrypt, decrypt } = await import('../lib/crypto.js');
const { sign, verify, parseCookies } = await import('../lib/session.js');
const { appJwt } = await import('../lib/githubApp.js');

test('tokens round-trip and tampering is detected', () => {
  const enc = encrypt('secret_token');
  assert.notEqual(enc, 'secret_token');
  assert.equal(decrypt(enc), 'secret_token');
  const raw = Buffer.from(enc, 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decrypt(raw.toString('base64')));
});

test('signed cookies verify, expire and reject tampering', () => {
  const token = sign({ uid: 7 }, 60);
  assert.equal(verify(token).uid, 7);
  assert.equal(verify(token.replace(/(?<=\..{5})./, (c) => (c === 'a' ? 'b' : 'a'))), null);
  assert.equal(verify(sign({ uid: 7 }, -1)), null);
  assert.equal(verify('garbage'), null);
});

test('cookie header parsing', () => {
  assert.deepEqual(parseCookies('a=1; rs_session=abc.def'), { a: '1', rs_session: 'abc.def' });
});

test('GitHub App JWT is a valid RS256 token', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = appJwt({ appId: 123, privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }), now: 1000 });
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iat: 940, exp: 1540, iss: '123' });
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
});
