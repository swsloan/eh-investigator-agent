---
name: extrahop-triggers
description: Build, modify, debug, and review ExtraHop Trigger API JavaScript. Use to write ExtraHop triggers, choose trigger events, inspect protocol class properties and methods, create custom metrics or records, use Flow/session/datastore APIs, export data through Remote open data streams, or configure advanced trigger options
---

# ExtraHop Triggers

Use this skill to author ExtraHop Trigger API JavaScript with the current generated Trigger API reference. Prefer exact event, class, method, and property names from the reference over memory.

## Reference Routing

Start with `references/trigger-api/index.md` unless the user already named an event, class, or method.

- Use `references/trigger-api/event-index.json` when the request names an event such as `HTTP_RESPONSE`, `SSL_OPEN`, `TCP_PAYLOAD`, or `REMOTE_RESPONSE`.
- Use `references/trigger-api/class-manifest.json` when the request names a class or protocol and you need its file path, events, methods, property count, or `commitRecord()` support.
- Use `references/trigger-api/protocol-index.md` for protocol and network trigger work.
- Use `references/trigger-api/record-commit-matrix.md` before writing recordstore logic or calling `commitRecord()`.
- Use `references/trigger-api/advanced-trigger-options.md` before payload parsing, metric cycle triggers, external data triggers, or any event that requires trigger configuration beyond selecting an event.
- Use `references/trigger-api/examples.md` for implementation patterns after loading the relevant class files.
- Use `references/trigger-api/deprecated-api.md` when updating old trigger code or replacing removed APIs.

Class shards live under:

- `references/trigger-api/classes/general/` for `Flow`, `Device`, `Application`, `Session`, `Buffer`, metric source classes, and other general APIs.
- `references/trigger-api/classes/protocol/` for protocol classes such as `HTTP`, `SSL`, `DNS`, `TCP`, `CIFS`, and `NetFlow`.
- `references/trigger-api/classes/remote/` for `Remote.HTTP`, `Remote.Kafka`, `Remote.MongoDB`, `Remote.Raw`, `Remote.Syslog`, and `Remote`.
- `references/trigger-api/classes/datastore/` for `MetricCycle`, `MetricRecord`, `AlertRecord`, `Dataset`, `Sampleset`, and `Topnset`.

## Authoring Workflow

1. Identify the trigger event or protocol class first. If unclear, inspect `event-index.json`, `protocol-index.md`, and likely class files before writing code.
2. Load the smallest relevant class files and advanced-options files. Do not load the whole generated reference unless the task is broad.
3. Confirm event-scoped properties. Many properties are only valid on request, response, open, close, tick, payload, or record events.
4. Confirm side effects and timing before committing records, modifying Flow/session state, starting packet capture, or exporting through Remote classes.
5. Prefer built-in trigger globals and Trigger API classes. Do not assume browser, Node.js, npm, filesystem, or asynchronous JavaScript APIs are available in trigger scripts unless the ExtraHop reference explicitly supports them.
6. Keep trigger code efficient: avoid repeated large lookups, cache constant maps with `cache()`, guard debug output, and minimize payload parsing work.
7. When returning code, include the intended events and any required advanced trigger options.

## Common Checks

- For custom metrics, verify the metric source supports the metric method. The supported sources are covered in `references/trigger-api/concepts/custom-metric-data-types.md` and the relevant class files.
- For payload parsing, read the protocol class and `advanced-trigger-options.md`; payload buffers often require explicit collection settings.
- For records, check whether the class supports `commitRecord()` and whether records are committed immediately or after the paired response event.
- For `Remote.HTTP`, check `classes/remote/remote-http.md` and `classes/remote/remote.md` for response events, context, target naming, headers, and return semantics.
- For migrations, read `deprecated-api.md` and replace old globals, methods, properties, events, and classes with the documented current equivalents.

## Regenerating References

Generated reference version: `26.2`.

The generated Trigger API reference records the ExtraHop documentation version it was derived from in `references/trigger-api/index.json` (`source.doc_version`) and `references/trigger-api/index.md` (`Documentation version`). ExtraHop firmware and documentation versions follow `YY.Q`: for example, `26.1` is Q1 2026 and `26.2` is Q2 2026.

Before writing or reviewing trigger code, compare the current calendar quarter from the running environment with the generated reference version. If the current date is in a later quarter than the reference version, or if the reference version is missing or unknown, run the builder before coding:

```bash
python3 scripts/build_trigger_api_reference.py
```

The builder downloads `https://docs.extrahop.com/current/extrahop-trigger-api/` and regenerates `references/trigger-api/` with markdown shards plus JSON lookup files.

After a freshness refresh, tell the user that you checked or refreshed the ExtraHop Trigger API reference and state the documentation version reported by the builder. Use the refreshed local files for the current task. If the harness gives you permission to persist changes, permanently update the skill artifacts with the refreshed `references/trigger-api/` files and update the `Generated reference version` line above to the builder's reported version. If you cannot persist the refresh in the current environment, say so and continue with the local refreshed copy for the current task.
