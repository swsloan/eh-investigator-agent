#!/usr/bin/env python3
"""Build agent-friendly ExtraHop Trigger API reference files from the docs HTML."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Iterable

from lxml import html


DEFAULT_URL = "https://docs.extrahop.com/current/extrahop-trigger-api/"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126 Safari/537.36"
)

CLASS_SECTION_DIRS = {
    "general-purpose-classes": "classes/general",
    "protocol-and-network-data-classes": "classes/protocol",
    "open-data-stream-classes": "classes/remote",
    "datastore-classes": "classes/datastore",
}

CONCEPT_FILES = {
    "overview": "concepts/overview.md",
    "trigger-api-resources": "concepts/resources.md",
    "data-types-for-custom-metrics": "concepts/custom-metric-data-types.md",
    "global-functions": "global-functions.md",
    "deprecated-api-elements": "deprecated-api.md",
    "advanced-trigger-options": "advanced-trigger-options.md",
    "examples-349": "examples.md",
}


def slugify(value: str) -> str:
    value = re.sub(r"`", "", value.strip().lower())
    value = re.sub(r"remote\.", "remote-", value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "section"


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def safe_title(node) -> str:
    for anchor in node.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " heading-anchor ")]'):
        anchor.drop_tree()
    return clean_text(node.text_content())


def make_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def fetch(url: str) -> tuple[bytes, dict[str, str]]:
    with urllib.request.urlopen(make_request(url), timeout=60) as response:
        headers = {k.lower(): v for k, v in response.headers.items()}
        return response.read(), headers


def element_id(node) -> str | None:
    if node.get("id"):
        return node.get("id")
    anchors = node.xpath('.//*[@id]')
    return anchors[0].get("id") if anchors else None


def first_heading(node, tag: str) -> object | None:
    hits = node.xpath(f".//{tag}")
    return hits[0] if hits else None


def nearest_topic(node):
    for ancestor in [node, *node.iterancestors()]:
        cls = f" {ancestor.get('class', '')} "
        if " topic " in cls or " nested0 " in cls or " nested1 " in cls:
            return ancestor
    return node


def remove_noise(root) -> None:
    for pattern in [
        ".//script",
        ".//style",
        ".//button",
        './/*[contains(concat(" ", normalize-space(@class), " "), " copy-button ")]',
        './/*[contains(concat(" ", normalize-space(@class), " "), " heading-anchor ")]',
        ".//noscript",
    ]:
        for node in root.xpath(pattern):
            node.drop_tree()


def inline_md(node) -> str:
    tag = node.tag.lower() if isinstance(node.tag, str) else ""
    if tag in {"code", "samp", "var"}:
        text = clean_text(node.text_content())
        return f"`{text}`" if text else ""
    if tag == "a":
        text = clean_text(node.text_content())
        href = node.get("href", "")
        if href.startswith("#"):
            return f"[{text}]({href})" if text else href
        if href.startswith("/"):
            href = f"https://docs.extrahop.com{href}"
        return f"[{text}]({href})" if href and text else text
    parts = [node.text or ""]
    for child in node:
        parts.append(inline_md(child))
        parts.append(child.tail or "")
    return clean_text("".join(parts))


def table_to_md(table) -> str:
    rows: list[list[str]] = []
    for tr in table.xpath(".//tr"):
        cells = tr.xpath("./th|./td")
        if not cells:
            continue
        rows.append([inline_md(cell).replace("|", "\\|") for cell in cells])
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header = rows[0]
    separator = ["---"] * width
    body = rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(separator) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines) + "\n\n"


def render_children(node, level: int = 1) -> str:
    parts: list[str] = []
    if node.text and clean_text(node.text):
        parts.append(clean_text(node.text) + "\n\n")
    for child in node:
        parts.append(render_node(child, level))
        if child.tail and clean_text(child.tail):
            parts.append(clean_text(child.tail) + "\n\n")
    return "".join(parts)


def render_list(node, ordered: bool, level: int) -> str:
    lines: list[str] = []
    for index, li in enumerate(node.xpath("./li"), 1):
        marker = f"{index}." if ordered else "-"
        text_parts: list[str] = []
        nested_parts: list[str] = []
        if li.text and clean_text(li.text):
            text_parts.append(clean_text(li.text))
        for child in li:
            if child.tag.lower() in {"ul", "ol"}:
                nested = render_list(child, child.tag.lower() == "ol", level + 1)
                nested_parts.append("\n".join("  " + line for line in nested.rstrip().splitlines()))
            else:
                text_parts.append(inline_md(child))
                if child.tail and clean_text(child.tail):
                    text_parts.append(clean_text(child.tail))
        line = f"{marker} {' '.join(part for part in text_parts if part).strip()}"
        lines.append(line.rstrip())
        lines.extend(nested_parts)
    return "\n".join(lines) + "\n\n"


def render_dl(node, level: int) -> str:
    lines: list[str] = []
    current_term = None
    for child in node:
        tag = child.tag.lower() if isinstance(child.tag, str) else ""
        if tag == "dt":
            current_term = clean_text(child.text_content())
        elif tag == "dd":
            desc = render_children(child, level).strip() or inline_md(child)
            if current_term:
                lines.append(f"- **{current_term}**: {desc}")
                current_term = None
            else:
                lines.append(f"- {desc}")
    return "\n".join(lines) + "\n\n"


def render_node(node, level: int = 1) -> str:
    if not isinstance(node.tag, str):
        return ""
    tag = node.tag.lower()
    if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        rank = int(tag[1])
        title = safe_title(node)
        return f"{'#' * min(rank, 6)} {title}\n\n" if title else ""
    if tag == "pre":
        text = node.text_content().strip("\n")
        return f"```javascript\n{text}\n```\n\n" if text else ""
    if tag == "code":
        return f"`{clean_text(node.text_content())}`"
    if tag == "p":
        text = inline_md(node)
        return f"{text}\n\n" if text else ""
    if tag == "ul":
        return render_list(node, False, level)
    if tag == "ol":
        return render_list(node, True, level)
    if tag == "dl":
        return render_dl(node, level)
    if tag == "table":
        return table_to_md(node)
    if tag in {"div", "section", "article", "main", "tbody", "thead"}:
        return render_children(node, level)
    if tag == "br":
        return "\n"
    text = inline_md(node)
    return f"{text}\n\n" if text else render_children(node, level)


def markdown_for_topic(topic) -> str:
    clone = html.fromstring(html.tostring(topic, encoding="unicode"))
    remove_noise(clone)
    md = render_node(clone)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


def class_metadata(topic, section_id: str, title: str, source_url: str, doc_version: str) -> dict:
    heading = first_heading(topic, "h3")
    metadata = {
        "doc_kind": "class",
        "api_area": "trigger-api",
        "section": section_id,
        "name": title,
        "anchor": element_id(heading if heading is not None else topic),
        "source_url": source_url,
        "source_version": doc_version,
        "events": [],
        "methods": [],
        "properties": [],
        "examples": [],
    }
    for h4 in topic.xpath(".//h4"):
        label = safe_title(h4).lower()
        parent = h4.getparent()
        terms = [clean_text(dt.text_content()) for dt in parent.xpath(".//dt") if clean_text(dt.text_content())]
        links = [clean_text(a.text_content()) for a in parent.xpath(".//a") if clean_text(a.text_content())]
        if "event" in label:
            metadata["events"].extend(terms or [x for x in links if re.search(r"[A-Z]+_", x)])
        elif "method" in label:
            metadata["methods"].extend(terms)
        elif "propert" in label:
            metadata["properties"].extend(terms)
        elif "example" in label:
            metadata["examples"].extend([x for x in links if x.lower().startswith("example:")])
    for key in ("events", "methods", "properties", "examples"):
        seen = set()
        values = []
        for value in metadata[key]:
            value = clean_text(value)
            if value and value not in seen:
                seen.add(value)
                values.append(value)
        metadata[key] = values
    return metadata


def concept_metadata(section_id: str, title: str, source_url: str, doc_version: str) -> dict:
    return {
        "doc_kind": "reference_section",
        "api_area": "trigger-api",
        "section": section_id,
        "name": title,
        "source_url": source_url,
        "source_version": doc_version,
    }


def frontmatter(metadata: dict) -> str:
    return "---\n" + json.dumps(metadata, indent=2, sort_keys=True) + "\n---\n\n"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def find_sections(main) -> list:
    h2s = main.xpath('.//h2[@id]')
    return [nearest_topic(h2) for h2 in h2s]


def child_class_topics(section) -> list:
    topics = []
    for h3 in section.xpath(".//h3[@id]"):
        topic = nearest_topic(h3)
        if topic not in topics:
            topics.append(topic)
    return topics


def build_index(generated: list[dict], source_meta: dict) -> str:
    by_group: dict[str, list[dict]] = {}
    for item in generated:
        by_group.setdefault(item["group"], []).append(item)
    lines = [
        "# ExtraHop Trigger API Reference",
        "",
        "Agent-friendly reference generated from the current ExtraHop Trigger API documentation.",
        "",
        "## Source",
        "",
        f"- URL: {source_meta['source_url']}",
        f"- Documentation version: {source_meta['doc_version']}",
        f"- Last modified: {source_meta.get('last_modified') or 'unknown'}",
        f"- Generated at: {source_meta['generated_at']}",
        "",
        "## How to Search",
        "",
        "- Start here to choose a narrow file, then load only the matching class, section, or examples file.",
        "- Use `index.json` for machine-readable class/event/method/property lookup.",
        "- Use `rg \"EVENT_NAME|ClassName|propertyName\" references/trigger-api` for fast local search.",
        "",
    ]
    for group in sorted(by_group):
        lines.append(f"## {group.replace('/', ' / ').replace('-', ' ').title()}")
        lines.append("")
        for item in sorted(by_group[group], key=lambda x: x["name"].lower()):
            lines.append(f"- [{item['name']}]({item['path']})")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def class_records(index_records: list[dict]) -> list[dict]:
    return [record for record in index_records if record.get("doc_kind") == "class"]


def build_class_manifest(records: list[dict]) -> dict:
    classes = []
    for record in class_records(records):
        methods = record.get("methods", [])
        properties = record.get("properties", [])
        classes.append(
            {
                "class": record["name"],
                "path": record["path"],
                "section": record["section"],
                "anchor": record.get("anchor"),
                "source_version": record.get("source_version"),
                "events": record.get("events", []),
                "methods": methods,
                "properties": properties,
                "property_count": len(properties),
                "supports_commit_record": any("commitRecord" in method for method in methods),
                "large_class": len(properties) >= 50 or record["name"] in {"HTTP", "SSL", "TCP", "RTCP", "WSMAN"},
                "examples": record.get("examples", []),
            }
        )
    return {"classes": sorted(classes, key=lambda item: item["class"].lower())}


def build_event_index(records: list[dict]) -> dict:
    events: dict[str, list[dict]] = {}
    for record in class_records(records):
        for event in record.get("events", []):
            events.setdefault(event, []).append(
                {
                    "class": record["name"],
                    "path": record["path"],
                    "section": record["section"],
                    "methods": record.get("methods", []),
                    "property_count": len(record.get("properties", [])),
                }
            )
    return {"events": {name: events[name] for name in sorted(events)}}


def build_protocol_index(records: list[dict]) -> str:
    rows = [
        "# Protocol And Network Class Index",
        "",
        "Use this as the first stop for protocol-specific trigger work. Load the linked class file for full events, methods, properties, and examples.",
        "",
        "| Class | Events | Methods | Properties | commitRecord | File |",
        "| --- | --- | ---: | ---: | --- | --- |",
    ]
    for record in sorted(class_records(records), key=lambda item: item["name"].lower()):
        if record.get("section") != "protocol-and-network-data-classes":
            continue
        methods = record.get("methods", [])
        rows.append(
            "| {name} | {events} | {method_count} | {property_count} | {commit_record} | [{name}]({path}) |".format(
                name=record["name"],
                events=", ".join(record.get("events", [])) or "-",
                method_count=len(methods),
                property_count=len(record.get("properties", [])),
                commit_record="yes" if any("commitRecord" in method for method in methods) else "no",
                path=record["path"],
            )
        )
    return "\n".join(rows) + "\n"


def build_commit_matrix(records: list[dict]) -> str:
    rows = [
        "# Record Commit Matrix",
        "",
        "Use this to quickly determine whether a class exposes `commitRecord()` and which events are involved. Load the class file for timing, record object, and event-specific caveats.",
        "",
        "| Class | Area | Events | commitRecord | File |",
        "| --- | --- | --- | --- | --- |",
    ]
    for record in sorted(class_records(records), key=lambda item: (item["section"], item["name"].lower())):
        methods = record.get("methods", [])
        has_commit = any("commitRecord" in method for method in methods)
        if not has_commit and record.get("section") not in {"protocol-and-network-data-classes", "open-data-stream-classes"}:
            continue
        rows.append(
            "| {name} | {area} | {events} | {commit_record} | [{name}]({path}) |".format(
                name=record["name"],
                area=record["section"],
                events=", ".join(record.get("events", [])) or "-",
                commit_record="yes" if has_commit else "no",
                path=record["path"],
            )
        )
    return "\n".join(rows) + "\n"


def build_groups(records: list[dict]) -> str:
    groups = {
        "auth_identity": ["AAA", "Kerberos", "LDAP", "NTLM"],
        "web_remoting": ["AJP", "HTTP", "WebSocket", "WSMAN", "SOCKS"],
        "db_file_mail": ["CIFS", "DB", "FTP", "NFS", "POP3", "SMTP", "TFTP"],
        "messaging_cache": ["ActiveMQ", "IBMMQ", "MSMQ", "Memcache", "Redis", "FIX"],
        "network_infra": ["CDP", "DHCP", "DHCP6", "DNS", "ICMP", "LLDP", "LLMNR", "NetFlow", "NTP", "SFlow", "SNMP", "TCP", "UDP"],
        "industrial_medical": ["BACnet", "DICOM", "DNP3", "HL7", "Modbus"],
        "realtime_remote_ui": ["ICA", "RDP", "RFB", "RTP", "RTCP", "SCCP", "SDP", "SIP", "SSH", "SSL", "Telnet", "QUIC"],
    }
    by_name = {record["name"]: record for record in class_records(records)}
    lines = [
        "# Protocol Class Groups",
        "",
        "Domain-oriented navigation for choosing protocol class shards. These groups are intentionally tags, not folders, so a class can still be found alphabetically in `classes/protocol/`.",
        "",
    ]
    for group, names in groups.items():
        lines.extend([f"## {group}", ""])
        for name in names:
            record = by_name.get(name)
            if record:
                lines.append(f"- [{name}]({record['path']})")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def emit_reference(source_url: str, output_dir: Path) -> dict:
    html_bytes, headers = fetch(source_url)
    doc = html.fromstring(html_bytes)
    main_hits = doc.xpath("//main")
    if not main_hits:
        raise RuntimeError("Unable to locate <main> in Trigger API page")
    main = main_hits[0]
    doc_version_hits = doc.xpath('//meta[@name="doc-version"]/@content')
    doc_version = doc_version_hits[0] if doc_version_hits else "unknown"
    source_meta = {
        "source_url": source_url,
        "doc_version": doc_version,
        "last_modified": headers.get("last-modified"),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
    }

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    generated: list[dict] = []
    index_records: list[dict] = []

    for section in find_sections(main):
        h2 = first_heading(section, "h2")
        if h2 is None:
            continue
        section_id = h2.get("id")
        title = safe_title(h2)
        if section_id in CLASS_SECTION_DIRS:
            group_dir = CLASS_SECTION_DIRS[section_id]
            class_topics = child_class_topics(section)
            summary_lines = [f"# {title}", "", "## Classes", ""]
            for topic in class_topics:
                h3 = first_heading(topic, "h3")
                class_title = safe_title(h3)
                slug = slugify(class_title)
                rel_path = f"{group_dir}/{slug}.md"
                metadata = class_metadata(topic, section_id, class_title, source_url, doc_version)
                write(output_dir / rel_path, frontmatter(metadata) + markdown_for_topic(topic))
                summary_lines.append(f"- [{class_title}]({slug}.md)")
                generated.append({"group": group_dir, "name": class_title, "path": rel_path})
                index_records.append({"path": rel_path, **metadata})
            summary_rel = f"{group_dir}/index.md"
            write(output_dir / summary_rel, "\n".join(summary_lines).rstrip() + "\n")
            generated.append({"group": group_dir, "name": title, "path": summary_rel})
        elif section_id in CONCEPT_FILES:
            rel_path = CONCEPT_FILES[section_id]
            metadata = concept_metadata(section_id, title, source_url, doc_version)
            write(output_dir / rel_path, frontmatter(metadata) + markdown_for_topic(section))
            group = rel_path.rsplit("/", 1)[0] if "/" in rel_path else "reference-sections"
            generated.append({"group": group, "name": title, "path": rel_path})
            index_records.append({"path": rel_path, **metadata})

    derived_files = {
        "class-manifest.json": json.dumps(build_class_manifest(index_records), indent=2) + "\n",
        "event-index.json": json.dumps(build_event_index(index_records), indent=2) + "\n",
        "protocol-index.md": build_protocol_index(index_records),
        "record-commit-matrix.md": build_commit_matrix(index_records),
        "groups.md": build_groups(index_records),
    }
    for rel_path, content in derived_files.items():
        write(output_dir / rel_path, content)
        generated.append({"group": "lookup-guides", "name": rel_path, "path": rel_path})

    source_meta["generated_files"] = len(generated)
    write(output_dir / "index.md", build_index(generated, source_meta))
    write(output_dir / "index.json", json.dumps({"source": source_meta, "records": index_records}, indent=2) + "\n")
    return source_meta


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default=DEFAULT_URL)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "references" / "trigger-api",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] = sys.argv[1:]) -> int:
    args = parse_args(argv)
    meta = emit_reference(args.source_url, args.output_dir)
    print(
        f"Generated {meta['generated_files']} reference entries for ExtraHop Trigger API "
        f"{meta['doc_version']} in {args.output_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
