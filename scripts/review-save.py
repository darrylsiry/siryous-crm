#!/usr/bin/env python3
"""Validate an agent's final message and write it as its report, verbatim. For UX, split the mockup
appendix into files first. Nothing else is added, so the report is the agent's own words.

  review-save.py <key> <output file> <reports dir>
"""
import os
import re
import sys

HEADERS = {"code": "# Code review: Siryous CRM", "security": "# Security review: Siryous CRM", "ux": "# UX review: Siryous CRM"}

key, out_file, reports = sys.argv[1:4]
text = open(out_file, encoding="utf-8").read().replace("\r\n", "\n")
header = HEADERS[key]
start = re.search(rf"^{re.escape(header)}\s*$", text, re.M)
if not start:
    sys.exit(f"The {key} agent did not return a report (no '{header}' line). Nothing was written.")
before = text[:start.start()].strip()
if before not in ("", "```markdown", "```"):
    sys.exit(f"The {key} agent added text before its report. Nothing was written.")
report = text[start.start():].rstrip()
if before and report.endswith("```"):
    report = report[:-3].rstrip()

dest = os.path.join(reports, key)
os.makedirs(dest, exist_ok=True)
if key == "ux":
    mockups = os.path.join(dest, "mockups")
    os.makedirs(mockups, exist_ok=True)

    def split(match):
        with open(os.path.join(mockups, match.group(1)), "w", encoding="utf-8") as f:
            f.write(match.group(2))
        return f"- {match.group(1)}"

    report = re.sub(r"^```html file=(UX-\d{3,4}\.html)\n(.*?)^```\s*$", split, report, flags=re.M | re.S)
    # A resolved finding's mockup described a change that has now been made.
    resolved = re.search(r"^## Resolved since last run\n(.*?)(?=^## |\Z)", report, re.M | re.S)
    for fid in re.findall(r"^-\s+\*\*(UX-\d{3,4})", resolved.group(1) if resolved else "", re.M):
        path = os.path.join(mockups, f"{fid}.html")
        if os.path.exists(path):
            os.remove(path)

with open(os.path.join(dest, "REPORT.md"), "w", encoding="utf-8") as f:
    f.write(report + "\n")
