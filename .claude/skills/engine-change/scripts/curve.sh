#!/bin/bash
# Response curve of one adjustment through the real shader (CanvasKit in Jest).
#   curve.sh <adjustment> [amount ...]      e.g. curve.sh highlights -1 -0.5
# Without amounts: min, min/2, -step, +step, max/2, max from ADJUSTMENT_INFO.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
ADJ="${1:?usage: curve.sh <adjustment> [amount ...]}"; shift
AMOUNTS="$(IFS=,; echo "$*")"
cd "$REPO"
CURVE_ADJ="$ADJ" CURVE_AMOUNTS="$AMOUNTS" npx jest --silent \
  --testPathIgnorePatterns '/node_modules/' --testMatch '**/engine-change/scripts/curve.probe.ts' \
  .claude/skills/engine-change/scripts/curve.probe.ts 2>&1 | grep -vE '^(PASS|Test Suites:|Tests:|Snapshots:|Time:|Ran all)' | sed '/^$/N;/^\n$/D'
