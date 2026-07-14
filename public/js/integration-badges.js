const INTEGRATIONS = {
  extrahop: {
    id: 'extrahop',
    label: 'ExtraHop',
    logo: '/vendor/integrations/extrahop-monogram.svg',
  },
  brave: {
    id: 'brave',
    label: 'Brave Search',
    logo: '/vendor/integrations/brave-browser-icon.svg',
  },
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo Search',
    logo: '/vendor/integrations/duckduckgo-icon.svg',
  },
  reversinglabs: {
    id: 'reversinglabs',
    label: 'ReversingLabs',
    logo: '/vendor/reversinglabs/square_logo.jpeg',
  },
  web: {
    id: 'web',
    label: 'Web Search',
    icon: 'globe',
  },
};

const EXTRAHOP_ACTIONS = {
  create_investigation: 'Create Investigation',
  search_detections: 'Search Detections',
  get_detection: 'Get Detection',
  update_detection: 'Update Detection',
  search_detectionactivity: 'Search Detection Activity',
  get_detectiontypemetadata: 'Get Detection Type Metadata',
  get_appliance_metadata: 'Get Appliance Metadata',
  get_extrahop_help_docs_url: 'Get Help Docs',
  search_devices: 'Search Devices',
  get_device: 'Get Device',
  search_devicegroups: 'Search Device Groups',
  search_records: 'Search Records',
  download_pcap: 'Download Packet Capture',
  search_devicetags: 'Search Device Tags',
  list_devicetags_for_device: 'List Device Tags',
  list_devices_in_devicegroup: 'List Devices',
  execute_metric_query: 'Query Metrics',
  search_metric_catalog: 'Search Metric Catalog',
  assign_devicetag_to_devices: 'Assign Device Tag',
  unassign_devicetag_from_devices: 'Unassign Device Tag',
  '-listtools': 'List Tools',
  '-help': 'Show Help',
  '--help': 'Show Help',
  '-version': 'Show Version',
  '--version': 'Show Version',
};

const REVERSINGLABS_ACTIONS = {
  status: 'Check Status',
  probe: 'Test Connection',
  'sample-status': 'Check Sample Status',
  reputation: 'Check Reputation',
  details: 'Get Sample Details',
  ticore: 'Get TiCore Report',
  search: 'Search Samples',
  'search-count': 'Count Search Results',
};

function commandFor(args) {
  if (!args || typeof args !== 'object') return '';
  return typeof args.command === 'string' ? args.command : '';
}

function interfaceAction(command, interfaceName) {
  const match = command.match(new RegExp(
    `(?:^|[^a-z0-9_-])(?:\\./)?${interfaceName}\\s+([a-z0-9_-]+)\\b`,
    'i',
  ));
  return match?.[1]?.toLowerCase() || '';
}

function withAction(integration, action, labels) {
  if (!integration) return null;
  const actionLabel = labels[action];
  return actionLabel ? { ...integration, label: `${integration.label} - ${actionLabel}` } : integration;
}

function isNativeWebSearch(toolName) {
  const normalized = String(toolName || '').toLowerCase().replace(/[^a-z]/g, '');
  return normalized === 'websearch' || normalized === 'searchweb';
}

function outputText(result) {
  return (result?.content || [])
    .filter((content) => content?.type === 'text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n');
}

export function integrationSourceForToolCall({ args, toolName } = {}) {
  const command = commandFor(args);
  if (/(?:^|[^a-z0-9_-])(?:\.\/)?reversinglabs-interface\b/i.test(command)) return 'reversinglabs';
  if (/(?:^|[^a-z0-9_-])(?:\.\/)?excli-interface\b/i.test(command)) return 'extrahop';
  if (/(?:^|[^a-z0-9_-])(?:\.\/)?research-interface\s+search\b/i.test(command)) return 'research';
  if (isNativeWebSearch(toolName)) return 'web';
  return '';
}

export function integrationForToolCall(ev = {}) {
  const source = integrationSourceForToolCall(ev);
  const command = commandFor(ev.args);
  if (source === 'extrahop') {
    return withAction(
      INTEGRATIONS.extrahop,
      interfaceAction(command, 'excli-interface'),
      EXTRAHOP_ACTIONS,
    );
  }
  if (source === 'reversinglabs') {
    return withAction(
      INTEGRATIONS.reversinglabs,
      interfaceAction(command, 'reversinglabs-interface'),
      REVERSINGLABS_ACTIONS,
    );
  }
  return integrationBySource(source);
}

export function integrationForResearchResult({ result } = {}, fallbackProvider = '') {
  const output = outputText(result);
  const providerMatch = output.match(/"provider"\s*:\s*"(brave|duckduckgo)"/i);
  if (providerMatch) return INTEGRATIONS[providerMatch[1].toLowerCase()];
  if (/\bbrave search\b/i.test(output)) return INTEGRATIONS.brave;
  if (/\bduckduckgo\b/i.test(output)) return INTEGRATIONS.duckduckgo;
  return integrationBySource(fallbackProvider);
}

export function integrationBySource(source) {
  return INTEGRATIONS[source] || null;
}
