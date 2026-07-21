export const SESSION_STATE_VERSION = 2;
export const DEFAULT_MAX_SESSION_STATE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_LEGACY_STATE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_SESSION_META_BYTES = 256 * 1024;
export const DEFAULT_MAX_SESSION_INDEX_BYTES = 32 * 1024 * 1024;

const MAX_MESSAGE_TEXT_CHARS = 256 * 1024;
const MAX_TOOL_RESULT_CHARS = 64 * 1024;
const MAX_TOOL_ARGS_CHARS = 32 * 1024;
export const DEFAULT_MAX_DURABLE_EVENTS = 5_000;
const PRUNED_NOTICE = {
  type: 'history_notice',
  message: 'Older conversation details were pruned to keep this session fast and stable. Workspace evidence and reports are unchanged.',
};

function truncateText(value, maxChars) {
  if (typeof value !== 'string' || value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n\n[Truncated ${omitted.toLocaleString('en-US')} characters from durable chat history.]`;
}

function boundedJsonValue(value, maxChars) {
  if (value === undefined) return undefined;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { truncated: true, preview: '[Unserializable tool value]' };
  }
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    preview: truncateText(serialized, maxChars),
  };
}

function projectMessage(message = {}) {
  if (!['user', 'assistant'].includes(message.role)) return null;
  const sourceContent = Array.isArray(message.content) ? message.content : [];
  let lastTextIndex = -1;
  for (let index = 0; index < sourceContent.length; index++) {
    if (sourceContent[index]?.type === 'text' && typeof sourceContent[index].text === 'string') {
      lastTextIndex = index;
    }
  }
  const content = [];
  for (let index = 0; index <= lastTextIndex; index++) {
    const block = sourceContent[index];
    if (block?.type === 'text' && typeof block.text === 'string') {
      content.push({ type: 'text', text: truncateText(block.text, MAX_MESSAGE_TEXT_CHARS) });
    } else {
      // Streaming blocks use their original content indexes. Preserve a tiny
      // placeholder for non-text blocks before visible text so the authoritative
      // message_end updates that same DOM block instead of creating a duplicate.
      content.push({ type: 'placeholder' });
    }
  }
  return {
    role: message.role,
    content,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    ...(message.stopReason ? { stopReason: message.stopReason } : {}),
    ...(message.errorMessage ? { errorMessage: truncateText(message.errorMessage, 8_192) } : {}),
    ...(message.usage && typeof message.usage === 'object' ? { usage: message.usage } : {}),
  };
}

/**
 * Convert a live backend event into the small, completed-history representation
 * needed to rebuild the browser chat after a restart. Streaming message starts,
 * deltas, tool updates, and agent boundaries intentionally remain live-only.
 */
export function durableReplayEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'message_end') {
    const message = projectMessage(event.message);
    return message ? { type: 'message_end', message } : null;
  }
  if (event.type === 'tool_execution_start') {
    return {
      type: 'tool_execution_start',
      toolCallId: event.toolCallId || event.id || '',
      toolName: event.toolName || event.name || 'tool',
      args: boundedJsonValue(event.args, MAX_TOOL_ARGS_CHARS),
    };
  }
  if (event.type === 'tool_execution_end') {
    const content = [];
    const rawContent = Array.isArray(event.result?.content) ? event.result.content : [];
    let remaining = MAX_TOOL_RESULT_CHARS;
    for (const item of rawContent) {
      if (remaining <= 0) break;
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      const text = truncateText(item.text, remaining);
      content.push({ type: 'text', text });
      remaining -= Math.min(item.text.length, remaining);
    }
    return {
      type: 'tool_execution_end',
      toolCallId: event.toolCallId || event.id || '',
      toolName: event.toolName || event.name || 'tool',
      isError: Boolean(event.isError),
      result: { content },
    };
  }
  if (event.type === 'challenger_status') {
    return {
      ...event,
      message: truncateText(event.message || '', 8_192),
    };
  }
  if (event.type === 'session_error') {
    return { type: 'session_error', error: truncateText(event.error || 'Session error', 8_192) };
  }
  if (event.type === 'agent_end') return { type: 'agent_end' };
  if (event.type === 'history_notice') return PRUNED_NOTICE;
  return null;
}

export function serializedJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * Normalize legacy/live event arrays and keep their newest useful events under
 * a deterministic byte/event budget. Evidence files are never touched.
 */
export function compactDurableTranscript(events, {
  maxBytes = DEFAULT_MAX_SESSION_STATE_BYTES - 64 * 1024,
  maxEvents = DEFAULT_MAX_DURABLE_EVENTS,
} = {}) {
  const projected = [];
  for (const event of Array.isArray(events) ? events : []) {
    const durable = durableReplayEvent(event);
    if (durable) projected.push(durable);
  }

  const eventLimit = Math.max(0, Math.floor(maxEvents));
  let pruned = projected.length > eventLimit;
  const tail = eventLimit ? projected.slice(-eventLimit) : [];
  const kept = [];
  let bytes = 2;
  for (let i = tail.length - 1; i >= 0; i--) {
    const eventBytes = serializedJsonBytes(tail[i]) + (kept.length ? 1 : 0);
    if (bytes + eventBytes > maxBytes) {
      pruned = true;
      break;
    }
    kept.push(tail[i]);
    bytes += eventBytes;
  }
  kept.reverse();
  if (!pruned) return kept;

  const noticeBytes = serializedJsonBytes(PRUNED_NOTICE);
  if (eventLimit < 1 || 2 + noticeBytes > maxBytes) return [];
  let start = 0;
  let keptCount = kept.length;
  while (keptCount > 0) {
    const totalWithNotice = bytes + noticeBytes + 1;
    if (keptCount + 1 <= eventLimit && totalWithNotice <= maxBytes) break;
    bytes -= serializedJsonBytes(kept[start]) + (keptCount > 1 ? 1 : 0);
    start += 1;
    keptCount -= 1;
  }
  return [PRUNED_NOTICE, ...kept.slice(start)];
}

/** Keep Pi RPC deltas tiny by explicitly selecting the fields the browser uses. */
export function slimLiveEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.type === 'message_start') {
    return {
      type: 'message_start',
      message: { role: event.message?.role || 'assistant' },
    };
  }
  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent || {};
    return {
      type: 'message_update',
      assistantMessageEvent: {
        ...(update.type ? { type: update.type } : {}),
        ...(Number.isInteger(update.contentIndex) ? { contentIndex: update.contentIndex } : {}),
        ...(typeof update.delta === 'string' ? { delta: update.delta } : {}),
        ...(typeof update.content === 'string' ? { content: update.content } : {}),
      },
    };
  }
  if (event.type === 'tool_execution_update') {
    return {
      type: 'tool_execution_update',
      ...(event.id ? { id: event.id } : {}),
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      ...(event.status ? { status: event.status } : {}),
    };
  }
  if (event.type === 'message_end' && !['user', 'assistant'].includes(event.message?.role)) {
    return { type: 'message_end', message: { role: event.message?.role || 'toolResult', content: [] } };
  }
  if (['message_end', 'tool_execution_start', 'tool_execution_end', 'session_error', 'challenger_status'].includes(event.type)) {
    return durableReplayEvent(event) || event;
  }
  if (event.type === 'agent_end') return { type: 'agent_end' };
  return event;
}
