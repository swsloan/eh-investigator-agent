// What a session's turn actually cost, read off its transcript.
//
// One definition, three consumers: the in-app eval runner, the GET /:id/usage
// route (which is how the external live harness captures per-case cost), and
// anything else that needs to answer "what did this investigation spend". It
// lived inside lib/eval-runner.js until the live harness needed it too, and a
// second copy is exactly how two runs of the same thing end up disagreeing.

// The delegating tool ships under more than one name, so "did this call delegate"
// has a single owner shared with the UI.
import { isDelegationTool } from '../public/js/tool-phrases.js';

/**
 * Sum cost + tokens from a session transcript (message_end usage). Cost is
 * authoritative (only the result event carries total_cost_usd); tokens is
 * approximate — it sums per-message totals (incl. cache-read tokens) so it
 * over-counts. Use cost, not tokens, for gating/comparison.
 *
 * Delegated work (#120) is counted too, from `subagent_usage`. It has to be:
 * a subagent's tokens are real spend, and a measurement that ignored them would
 * make delegation look free. Those events carry no cost of their own (cost
 * arrives once, whole-turn, on the result), so including them cannot
 * double-count the bill. `cacheRead` is broken out because it is ~97% of the
 * bill and therefore the number any context-scoping claim stands or falls on.
 */
export function sumUsage(transcript = []) {
  let cost = 0, tokens = 0, cacheRead = 0;
  let delegatedTokens = 0, delegatedCacheRead = 0, delegations = 0;
  for (const e of transcript) {
    const u = e?.message?.usage;
    if (e?.type === 'message_end' && u) {
      cost += Number(u.cost?.total || 0);
      tokens += Number(u.totalTokens || 0);
      cacheRead += Number(u.cacheRead || 0);
    } else if (e?.type === 'subagent_usage' && e.usage) {
      const t = Number(e.usage.totalTokens || 0);
      const cr = Number(e.usage.cacheRead || 0);
      tokens += t; cacheRead += cr;
      delegatedTokens += t; delegatedCacheRead += cr;
    } else if (e?.type === 'tool_execution_start' && isDelegationTool(e.toolName) && !e.parentToolCallId) {
      delegations++;
    }
  }
  return {
    cost: Number(cost.toFixed(4)),
    tokens,
    cacheRead,
    delegatedTokens,
    delegatedCacheRead,
    delegations,
  };
}

/**
 * The same figures under the snake_case keys the eval scorer reads, ready to be
 * merged into a case result. Keeping the mapping here means the live harness and
 * the in-app runner cannot drift into reporting different field names for the
 * same measurement.
 */
export function usageAsCaseMeta(usage) {
  return {
    cost_usd: usage.cost,
    tokens: usage.tokens,
    cache_read: usage.cacheRead,
    delegated_tokens: usage.delegatedTokens,
    delegated_cache_read: usage.delegatedCacheRead,
    delegations: usage.delegations,
  };
}
