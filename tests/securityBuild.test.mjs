import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifySecurityBuild } from '../scripts/verify_security_build.mjs';

test('public build gate rejects injected scripts, inline handlers, weak CSP and private credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'security-build-'));
  const script = 'console.log("approved")';
  const hash = createHash('sha256').update(script).digest('base64');
  const html = `<meta http-equiv="content-security-policy" content="script-src 'self' 'sha256-${hash}'; object-src 'none'; base-uri 'none'"><script>${script}</script><script type="application/json">{}</script>`;
  const verify = (source, env = {}) => {
    fs.writeFileSync(path.join(directory, 'index.html'), source);
    return verifySecurityBuild(directory, env);
  };
  try {
    assert.equal(verify(html), 1);
    assert.throws(() => verify(html.replace(script, 'alert("injected")')), /matching hash/);
    assert.throws(() => verify(html + '<form onsubmit="alert(1)"></form>'), /event handler/);
    assert.throws(() => verify(html.replace("script-src 'self'", "script-src 'unsafe-inline'")), /weak script CSP/);
    const secret = 'private-credential-fixture';
    assert.throws(() => verify(html + secret, { SUPABASE_SERVICE_ROLE_KEY: secret }), /private credential/);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.test';
    assert.throws(() => verify(html + jwt), /service role/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
