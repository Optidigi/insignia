import assert from 'node:assert/strict';
import test from 'node:test';
import { logClientChainDiagnostic } from '../src/server/client-chain-diagnostic.ts';

test('client-chain diagnostic is off by default and never logs an address', () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    const request = new Request('https://app.insigniacustomizer.com/api/artwork/v1/config', {
      headers: {
        host: 'app.insigniacustomizer.com',
        'x-insignia-client-chain': '198.51.100.7, 2001:db8::1',
        'x-forwarded-for': 'junk',
      },
    });
    logClientChainDiagnostic(request, {});
    assert.equal(lines.length, 0);
    logClientChainDiagnostic(new Request('https://app.insigniacustomizer.com/live'), {
      INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC: '1',
    });
    assert.equal(lines.length, 0);
    logClientChainDiagnostic(request, { INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC: '1' });
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]?.includes('198.51.100.7') && !lines[0]?.includes('2001:db8'));
    const logged = JSON.parse(lines[0] ?? '{}');
    assert.equal(logged.host, 'canonical');
    assert.deepEqual(
      logged.chain.map((e: { family: string }) => e.family),
      ['v4', 'v6'],
    );
    assert.match(logged.chain[0].hash, /^[0-9a-f]{6}$/);
    assert.deepEqual(logged.forwardedFor, [{ family: 'invalid', hash: null }]);
    assert.equal(logged.connectingIp, null);
  } finally {
    console.log = original;
  }
});
