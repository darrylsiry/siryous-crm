---
description: Run the independent code auditor for Siryous CRM and refresh data/agent-reports/code/REPORT.md
---

Run the independent code auditor. You are only the launcher. The review happens in a separate process that
shares nothing with this session or with the other review agents, so do not review anything yourself
and do not add your opinions to its report.

1. Run `scripts/review-run.sh code $ARGUMENTS` in the background and wait for it to finish. It can
   take a long time. It skips the run if the code it covers has not changed, unless the argument is `force`.
2. If it was skipped or failed, say so in one line with what it printed, and stop.
3. Read only `data/agent-reports/code/REPORT.md` and print its summary, then each top-severity item in
   full, then one line per other item, then what was resolved.

Do not read any other agent's report in this step. Argument: $ARGUMENTS
