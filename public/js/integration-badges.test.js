import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  integrationSourceForToolCall,
  integrationForToolCall,
} from './integration-badges.js';

test('classifies brokered interface commands by source', () => {
  assert.equal(integrationSourceForToolCall({ args: { command: './reversinglabs-interface reputation -json \'{}\'' } }), 'reversinglabs');
  assert.equal(integrationSourceForToolCall({ args: { command: './excli-interface search_detections -json \'{}\'' } }), 'extrahop');
  assert.equal(integrationSourceForToolCall({ args: { command: 'cat evidence/foo.json' } }), '');
});

test('maps ReversingLabs actions to a labeled badge with a logo', () => {
  const badge = integrationForToolCall({ toolName: 'bash', args: { command: './reversinglabs-interface reputation -json \'{"hashes":["abc"]}\'' } });
  assert.equal(badge.id, 'reversinglabs');
  assert.equal(badge.label, 'ReversingLabs - Check Reputation');
  assert.match(badge.logo, /reversinglabs/);
});

test('maps excli actions to an ExtraHop badge', () => {
  const badge = integrationForToolCall({ toolName: 'bash', args: { command: './excli-interface get_device -json \'{"id":1}\'' } });
  assert.equal(badge.id, 'extrahop');
  assert.equal(badge.label, 'ExtraHop - Get Device');
});

test('a ReversingLabs call with an unknown subcommand still badges the vendor', () => {
  const badge = integrationForToolCall({ toolName: 'bash', args: { command: './reversinglabs-interface frobnicate' } });
  assert.equal(badge.id, 'reversinglabs');
  assert.equal(badge.label, 'ReversingLabs');
});

test('non-integration tool calls produce no badge', () => {
  assert.equal(integrationForToolCall({ toolName: 'read', args: { path: 'evidence/x.json' } }), null);
  assert.equal(integrationForToolCall({ toolName: 'bash', args: { command: 'jq . evidence/x.json' } }), null);
});
