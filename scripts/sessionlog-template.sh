#!/bin/sh
# Prints a blank SESSIONLOG.md entry template to stdout. No files read or written.
# Usage: ./scripts/sessionlog-template.sh
#    or: sh scripts/sessionlog-template.sh

printf '%s\n' "---"
printf '%s\n' "Date: YYYY-MM-DD (timezone if helpful)"
printf '%s\n' "Focus: one line — what this burst was for"
printf '%s\n' "Files touched (high level):"
printf '%s\n' "  - area/path or \"docs only\" / \"no code\""
printf '%s\n' "Commands / tests run:"
printf '%s\n' "  - e.g. npm run safety:lk:rpa-local — PASS / SKIP / NOT RUN"
printf '%s\n' "  - e.g. psql \"\$STAGING_DATABASE_URL\" -f sql/… — NOT RUN"
printf '%s\n' "Observed state:"
printf '%s\n' "  - Green: …"
printf '%s\n' "  - Red / blocked: … (or \"none\")"
printf '%s\n' "What's next (1–3 bullets):"
printf '%s\n' "  - …"
printf '%s\n' "Notes:"
printf '%s\n' "  - optional"
printf '%s\n' "---"
