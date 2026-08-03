// Device role glyphs + identity avatars. Run: node --test public/js/topo-glyphs.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarSvg, identityType, roleGlyphGroup, roleGlyphInline, roleIconDataUri } from './topo-glyphs.js';

test('roleGlyphGroup maps roles to a pictogram, defaulting to a neutral dot', () => {
  assert.equal(roleGlyphGroup('domain_controller'), 'shield');
  assert.equal(roleGlyphGroup('file_server'), 'server');
  assert.equal(roleGlyphGroup('gateway'), 'gateway');
  assert.equal(roleGlyphGroup('pc'), 'monitor');
  assert.equal(roleGlyphGroup('ip_camera'), 'camera');
  assert.equal(roleGlyphGroup('something-unknown'), 'dot');
  assert.equal(roleGlyphGroup(''), 'dot');
});

test('roleIconDataUri is a self-contained data: URI SVG carrying the role colour', () => {
  const uri = roleIconDataUri('domain_controller', '#8b5cf6');
  assert.ok(uri.startsWith('data:image/svg+xml;utf8,'), 'a data URI, so CSP img-src data: allows it');
  const svg = decodeURIComponent(uri.replace('data:image/svg+xml;utf8,', ''));
  assert.match(svg, /<svg/);
  assert.match(svg, /fill="#8b5cf6"/, 'the disc is the role colour');
  assert.ok(!/<script/i.test(svg), 'no script in the icon');
});

test('roleGlyphInline renders an inline SVG for the legend', () => {
  const svg = roleGlyphInline('firewall', '#ef4444', 14);
  assert.match(svg, /^<svg width="14" height="14"/);
  assert.match(svg, /#ef4444/);
});

test('identityType infers the account kind from the principal', () => {
  assert.equal(identityType('WS01$@ACME.LAB'), 'computer', '$-suffixed machine account');
  assert.equal(identityType('svc-backup@ACME.LAB'), 'service');
  assert.equal(identityType('sql_agent@acme'), 'service');
  assert.equal(identityType('domain admins'), 'admin');
  assert.equal(identityType('administrator@acme'), 'admin');
  assert.equal(identityType('sean.todd@ACME.LAB'), 'user');
  assert.equal(identityType(''), 'user');
});

test('avatarSvg returns an inline SVG tagged with the type, falling back to user', () => {
  assert.match(avatarSvg('admin'), /class="topo-avatar admin"/);
  assert.match(avatarSvg('service'), /class="topo-avatar service"/);
  assert.match(avatarSvg('nonsense'), /class="topo-avatar user"/, 'unknown type falls back to user');
});
