#!/usr/bin/env python3
"""Generate GitHub520.plugin (Loon) from 521xueweihan/GitHub520 hosts.

Fetches the latest hosts list and converts it into a Loon plugin
with a [Host] section (domain = ip). Skips Timeout-marked entries.
"""
import datetime
import re
import sys
import urllib.request

HOSTS_URL = "https://raw.hellogithub.com/hosts"
OUT = "GitHub520/GitHub520.lpx"
VERSION = "1.2"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def parse_hosts(text: str):
    mappings = []
    update_time = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            m = re.search(r"Update time:\s*(.+)", line)
            if m:
                update_time = m.group(1).strip()
            continue
        if "# Timeout" in line:
            continue
        parts = line.split()
        if len(parts) >= 2:
            ip, domain = parts[0], parts[1]
            if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip) and re.match(r"^[a-zA-Z0-9._-]+$", domain):
                mappings.append((domain, ip))
    return mappings, update_time


def build_plugin(mappings, update_time, today) -> str:
    lines = [
        "#!name = GitHub520 加速",
        f"#!desc = [v{VERSION}] GitHub520 优选 IP 直连加速（{len(mappings)} 个域名：github.com / raw / api / avatars 等）+ GitHub 强制直连规则。数据源 521xueweihan/GitHub520，每日自动更新。更新于 {update_time}",
        "#!author = @Patatooo",
        "#!homepage = https://github.com/521xueweihan/GitHub520",
        f"#!date = {today}",
        "#!loon_version = 3.0.0",
        "#!tag = GitHub,加速,DNS",
        "#!system = iOS,iPadOS,tvOS,macOS",
        "#!type = normal",
        "",
        "[Rule]",
        "DOMAIN-SUFFIX,github.com,DIRECT",
        "DOMAIN-SUFFIX,githubusercontent.com,DIRECT",
        "DOMAIN-SUFFIX,githubassets.com,DIRECT",
        "DOMAIN-SUFFIX,github.io,DIRECT",
        "DOMAIN-SUFFIX,github.blog,DIRECT",
        "DOMAIN-SUFFIX,githubstatus.com,DIRECT",
        "DOMAIN-SUFFIX,github.community,DIRECT",
        "DOMAIN-SUFFIX,githubcopilot.com,DIRECT",
        "DOMAIN-SUFFIX,vscode.dev,DIRECT",
        "DOMAIN,github-cloud.s3.amazonaws.com,DIRECT",
        "DOMAIN,github-com.s3.amazonaws.com,DIRECT",
        "DOMAIN,github-production-release-asset-2e65be.s3.amazonaws.com,DIRECT",
        "DOMAIN,github-production-repository-file-5c1aeb.s3.amazonaws.com,DIRECT",
        "DOMAIN,github-production-user-asset-6210df.s3.amazonaws.com,DIRECT",
        "",
        "[Host]",
    ]
    for domain, ip in mappings:
        lines.append(f"{domain} = {ip}")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    text = fetch(HOSTS_URL)
    mappings, update_time = parse_hosts(text)
    if not mappings:
        sys.exit("ERROR: no mappings parsed")
    plugin = build_plugin(mappings, update_time, datetime.date.today().isoformat())
    with open(OUT, "w") as f:
        f.write(plugin)
    print(f"OK: {len(mappings)} mappings -> {OUT} (update_time={update_time})")
