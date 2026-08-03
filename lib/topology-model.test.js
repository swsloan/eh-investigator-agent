// Topology normalization + locality derivation. Run: node --test lib/topology-model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALITY_RULES, EXTERNAL_LOCALITY, UNKNOWN_LOCALITY,
  buildHierarchy, deriveLocality, nodeKey, normalize, parseLocalityRules,
} from './topology-model.js';

test('deriveLocality treats RFC1918 as internal and everything else as external', () => {
  assert.equal(deriveLocality('10.1.2.3'), 'Internal');
  assert.equal(deriveLocality('172.16.5.5'), 'Internal');
  assert.equal(deriveLocality('192.168.1.1'), 'Internal');
  assert.equal(deriveLocality('8.8.8.8'), EXTERNAL_LOCALITY);
  assert.equal(deriveLocality('203.0.113.10'), EXTERNAL_LOCALITY);
});

test('deriveLocality returns Unknown for missing or malformed addresses', () => {
  assert.equal(deriveLocality(''), UNKNOWN_LOCALITY);
  assert.equal(deriveLocality('not-an-ip'), UNKNOWN_LOCALITY);
  assert.equal(deriveLocality(null), UNKNOWN_LOCALITY);
});

test('a more specific rule wins over the broader range it sits inside', () => {
  const rules = [...DEFAULT_LOCALITY_RULES, { cidr: '10.5.0.0/16', name: 'DMZ' }];
  assert.equal(deriveLocality('10.5.1.1', rules), 'DMZ', 'the /16 carve-out beats the /8');
  assert.equal(deriveLocality('10.9.1.1', rules), 'Internal', 'outside the carve-out stays Internal');
});

test('non-RFC1918 internal space is grouped correctly once a rule is configured', () => {
  // The documented failure mode: a customer whose internal space is public-range.
  assert.equal(deriveLocality('12.34.56.78'), EXTERNAL_LOCALITY, 'wrong without a rule (known limitation)');
  const rules = [...DEFAULT_LOCALITY_RULES, { cidr: '12.34.0.0/16', name: 'Corp' }];
  assert.equal(deriveLocality('12.34.56.78', rules), 'Corp', 'right once the operator configures it');
});

test('malformed locality rules are dropped, not thrown', () => {
  const rules = parseLocalityRules([{ cidr: 'garbage', name: 'X' }, { cidr: '10.0.0.0/8', name: 'Internal' }, { name: 'no cidr' }]);
  assert.equal(rules.length, 1);
  assert.equal(deriveLocality('10.0.0.1', rules), 'Internal');
});

test('an IPv6 address does not crash against IPv4 rules', () => {
  // ipaddr.match() throws on a kind mismatch — the rule loop must skip, not blow up.
  assert.doesNotThrow(() => deriveLocality('fe80::1'));
  assert.equal(deriveLocality('fe80::1'), EXTERNAL_LOCALITY);
});

test('nodeKey prefers the durable OID and falls back to IP', () => {
  assert.equal(nodeKey({ oid: '4294967325', ip: '172.16.204.161' }), 'oid:4294967325');
  assert.equal(nodeKey({ ip: '172.16.204.161' }), 'ip:172.16.204.161');
  assert.equal(nodeKey({}), '');
});

test('normalize carries the richer inventory fields, and falls back for the name', () => {
  const { nodes } = normalize({
    devices: [
      { id: '1', dns_name: 'dc1.acme.lab', netbios_name: 'DC1', ipaddr: '10.0.0.10',
        vendor: 'VMware', software: 'Windows Server 2019', dhcp_name: 'dc1' },
      // No display name — the DNS name should stand in.
      { id: '2', dns_name: 'pc2.acme.lab', ipaddr: '10.0.0.50' },
    ],
  });
  const dc = nodes.find((n) => n.key === 'oid:1');
  assert.equal(dc.dns_name, 'dc1.acme.lab');
  assert.equal(dc.netbios_name, 'DC1');
  assert.equal(dc.dhcp_name, 'dc1');
  assert.equal(dc.vendor, 'VMware');
  assert.equal(dc.software, 'Windows Server 2019');
  assert.equal(nodes.find((n) => n.key === 'oid:2').name, 'pc2.acme.lab', 'DNS name fills in a missing display name');
});

const RAW = {
  collected_at: '2026-07-31T00:00:00Z',
  window: '-24h',
  devices: [
    { id: '1', name: 'dc1', ipaddr: '10.0.0.10', role: 'domain_controller', vlanid: '10', is_critical: true, discovery_id: 'abc' },
    { id: '2', name: 'pc1', ipaddr: '10.0.0.50', role: 'pc', vlanid: '10' },
    { id: '3', name: 'web', ipaddr: '10.0.1.20', role: 'http_server', vlanid: '20' },
    { id: '4', name: 'cdn', ipaddr: '203.0.113.9', role: 'other' },
  ],
  edges: [
    { src: '2', dst: '1', bytes_out: 100, bytes_in: 50, protocols: ['cifs'] },
    { src: '2', dst: '3', bytes_out: 10, bytes_in: 5 },
  ],
};

test('normalize builds nodes, canonical edges, and the zoom hierarchy', () => {
  const { snapshot, nodes, edges, tiers } = normalize(RAW, { group: 'lab' });
  assert.equal(nodes.length, 4);
  assert.equal(snapshot.device_count, 4);
  assert.equal(snapshot.group, 'lab');

  const dc = nodes.find((n) => n.name === 'dc1');
  assert.equal(dc.key, 'oid:1');
  assert.equal(dc.locality, 'Internal');
  assert.equal(dc.segment, 'vlan:10');
  assert.equal(dc.roleKey, 'vlan:10/domain_controller');
  assert.equal(dc.critical, true);
  assert.equal(dc.discovery_id, 'abc');

  assert.equal(nodes.find((n) => n.name === 'cdn').locality, EXTERNAL_LOCALITY);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].bytes_total, edges[0].bytes_in + edges[0].bytes_out);

  // Hierarchy: 2 localities (Internal/External), vlan10 + vlan20 + the external /24 proxy.
  assert.ok(tiers.localities.length >= 2);
  const internal = tiers.localities.find((l) => l.key === 'Internal');
  assert.equal(internal.device_count, 3, 'device counts roll up to the locality');
});

test('reciprocal observations of one conversation collapse into a single edge', () => {
  // Sweeping both endpoints yields A's view of B AND B's view of A — the same link.
  const { edges } = normalize({
    devices: [{ id: 'a', ipaddr: '10.0.0.1' }, { id: 'b', ipaddr: '10.0.0.2' }],
    edges: [
      { src: 'a', dst: 'b', bytes_out: 100, bytes_in: 20 },
      { src: 'b', dst: 'a', bytes_out: 20, bytes_in: 100 },
    ],
  });
  assert.equal(edges.length, 1, 'one conversation, not two edges');
  // Direction is preserved relative to the canonical src, and not double-counted.
  const e = edges[0];
  assert.equal(e.src, 'oid:a');
  assert.equal(e.bytes_out, 200, 'a→b from both observations');
  assert.equal(e.bytes_in, 40, 'b→a from both observations');
});

test('self-conversations and edges to undiscovered devices are dropped', () => {
  const { edges } = normalize({
    devices: [{ id: 'a', ipaddr: '10.0.0.1' }],
    edges: [
      { src: 'a', dst: 'a', bytes_out: 5 },
      { src: 'a', dst: 'ghost', bytes_out: 5 },
    ],
  });
  assert.equal(edges.length, 0);
});

test('edge endpoints resolve by key, OID, or bare IP to the same device', () => {
  const { edges } = normalize({
    devices: [{ id: '1', ipaddr: '10.0.0.1' }, { id: '2', ipaddr: '10.0.0.2' }],
    edges: [
      { src: '10.0.0.1', dst: '2', bytes_out: 1 },   // IP → OID
      { src: 'oid:1', dst: '10.0.0.2', bytes_out: 1 }, // key → IP, same pair
    ],
  });
  assert.equal(edges.length, 1, 'both spellings resolve to one canonical edge');
  assert.equal(edges[0].bytes_out, 2);
});

test('duplicate and malformed devices are dropped without throwing', () => {
  const { nodes } = normalize({
    devices: [{ id: '1', ipaddr: '10.0.0.1' }, { id: '1', ipaddr: '10.0.0.1' }, {}, null],
  });
  assert.equal(nodes.length, 1);
});

test('normalize tolerates entirely empty or junk input', () => {
  for (const input of [{}, null, undefined, { devices: 'nope', edges: 42 }]) {
    const out = normalize(input);
    assert.equal(out.nodes.length, 0);
    assert.equal(out.edges.length, 0);
    assert.ok(out.snapshot.id);
  }
});

test('identities are deduped and bound to resolvable devices only', () => {
  const { identities } = normalize({
    devices: [{ id: '1', ipaddr: '10.0.0.1' }],
    identities: [
      { name: 'sean.todd@ACMELEGAL.LAB', devices: ['1', 'ghost'] },
      { name: 'sean.todd@ACMELEGAL.LAB', devices: [] },
    ],
  });
  assert.equal(identities.length, 1);
  assert.deepEqual(identities[0].devices, ['oid:1'], 'the unknown device is dropped');
});

test('buildHierarchy nests roles inside segments inside localities', () => {
  const { nodes } = normalize(RAW);
  const t = buildHierarchy(nodes);
  const seg = t.segments.find((s) => s.key === 'vlan:10');
  assert.equal(seg.locality, 'Internal');
  assert.equal(seg.device_count, 2);
  assert.ok(seg.members.every((m) => m.startsWith('vlan:10/')), 'segment members are its role clusters');
});
