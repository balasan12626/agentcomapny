import test from 'node:test';
import assert from 'node:assert/strict';
import { redactAbsolutePaths, redactResponse, looksLikePath } from '../../src/core/redact.js';

const root = 'C:\\Users\\ASUS\\datylune-workspace\\demo';

test('absolute paths: workspace roots become <workspace>, others keep only the last segment', () => {
  assert.equal(redactAbsolutePaths(`wrote ${root}\\server.js ok`, [root]), 'wrote <workspace>\\server.js ok');
  assert.equal(redactAbsolutePaths('C:/Users/ASUS/other/x.txt'), '<path>/x.txt');
  assert.equal(redactAbsolutePaths('app at D:\\it-agent\\server'), 'app at <path>/server');
  assert.equal(redactAbsolutePaths('/home/bob/proj/a.js'), '<path>/a.js');
  assert.equal(redactAbsolutePaths('\\\\fileserver\\share\\f.txt'), '<path>/f.txt');
  assert.equal(redactAbsolutePaths('drive C:\\'), 'drive <path>');
  // Not paths: URLs, ratios, plain words.
  assert.equal(redactAbsolutePaths('https://example.com/home/x and ratio 3:2'), 'https://example.com/home/x and ratio 3:2');
  assert.equal(looksLikePath('nothing here'), false);
  assert.equal(looksLikePath(`see ${root}`), true);
});

test('no username survives any redaction', () => {
  for (const t of [`${root}\\a.js`, 'C:\\Users\\ASUS', 'c:/users/asus/x', '/Users/asus/x/y.md', '/home/asus/.ssh/id']) {
    assert.doesNotMatch(redactAbsolutePaths(t), /asus/i, t);
  }
});

test('response redaction walks objects and honours the keep list', () => {
  const body = { workspace: { allowedRoots: [root] }, report: `${root}\\README.md`, nested: [{ detail: `isolation: overlaps ${root}` }], n: 3, at: new Date(0) };
  const keep = (p) => /(^|\.)workspace\.allowedRoots\.\d+$/.test(p);
  const admin = redactResponse(body, { roots: [root], keep });
  assert.equal(admin.workspace.allowedRoots[0], root, 'admins keep the project setting');
  assert.equal(admin.report, '<workspace>\\README.md');
  assert.equal(admin.nested[0].detail, 'isolation: overlaps <workspace>');
  assert.equal(admin.n, 3);
  assert.ok(admin.at instanceof Date);
  const member = redactResponse(body, { roots: [root] });
  assert.equal(member.workspace.allowedRoots[0], '<workspace>');
  assert.doesNotMatch(JSON.stringify(member), /[A-Za-z]:\\\\/);
});
