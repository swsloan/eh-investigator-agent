# Custom Graphiti MCP image = upstream standalone + two local fixes:
#
#  1. Add the `anthropic` package. The upstream image ships without the
#     Anthropic LLM extra, so Graphiti falls back to "No LLM client configured"
#     and does no entity/edge extraction. We use Anthropic for extraction (D2).
#
#  2. Disable the MCP transport's DNS-rebinding Host check. The MCP SDK's
#     FastMCP auto-enables it with allowed_hosts = localhost/127.0.0.1 only,
#     which returns HTTP 421 when the app connects by the Docker service name
#     `graphiti-mcp`. This service is only reachable on the internal compose
#     network and loopback-published (127.0.0.1:8000), consistent with the
#     app's localhost-only model, so disabling the check here is safe.
FROM zepai/knowledge-graph-mcp:standalone

# (1) Anthropic extra
RUN VIRTUAL_ENV=/app/mcp/.venv /root/.local/bin/uv pip install \
      --python /app/mcp/.venv/bin/python --no-cache anthropic \
    && /app/mcp/.venv/bin/python -c "from graphiti_core.llm_client.anthropic_client import AnthropicClient; import anthropic; print('anthropic', anthropic.__version__)"

# (2) Disable DNS-rebinding Host validation on the FastMCP instance
RUN python3 - <<'PY'
p = '/app/mcp/src/graphiti_mcp_server.py'
s = open(p).read()
anchor = "    instructions=GRAPHITI_MCP_INSTRUCTIONS,\n"
inject = anchor + "    transport_security=__import__('mcp.server.transport_security', fromlist=['TransportSecuritySettings']).TransportSecuritySettings(enable_dns_rebinding_protection=False),\n"
assert anchor in s, "FastMCP anchor not found — upstream image changed; revisit patch"
open(p, 'w').write(s.replace(anchor, inject, 1))
print("patched: DNS-rebinding protection disabled")
PY

# (3) Newer Anthropic models (e.g. claude-sonnet-5) deprecate the `temperature`
#     parameter and reject the request whether it is null or a number.
#     graphiti-core's Anthropic client always sends it; drop the arg so the
#     API default is used.
RUN python3 - <<'PY'
p = '/app/mcp/.venv/lib/python3.11/site-packages/graphiti_core/llm_client/anthropic_client.py'
s = open(p).read()
line = "                temperature=self.temperature,\n"
assert line in s, "temperature line not found; graphiti-core changed, revisit patch"
open(p, 'w').write(s.replace(line, "", 1))
print("patched: dropped temperature from Anthropic messages.create")
PY
