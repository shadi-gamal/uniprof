#!/usr/bin/env bash
# Bootstrap script for setting up native (perf) environment in the uniprof container

set -e
set -o pipefail

# Color/TTY detection with NO_COLOR support
if [[ -n "${NO_COLOR:-}" ]]; then
    COLORS_ENABLED=0
elif [[ -n "${CLICOLORS_FORCE:-}" ]] && [[ "${CLICOLORS_FORCE}" != "0" ]]; then
    COLORS_ENABLED=1
elif [[ -n "${CLICOLORS:-}" ]] && [[ "${CLICOLORS}" == "0" ]]; then
    COLORS_ENABLED=0
elif [[ -t 1 ]]; then
    COLORS_ENABLED=1
else
    COLORS_ENABLED=0
fi

# Color codes (aligned with CLI formatter semantics)
if [[ "$COLORS_ENABLED" == "1" ]]; then
    GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; BLUE='\033[34m'; WHITE='\033[37m'; RESET='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; BLUE=''; WHITE=''; RESET=''
fi

# Minimal helpers (✓ message in white; ✗ message in red)
print_success() { echo -e "${GREEN}✓${RESET} ${WHITE}$1${RESET}"; }
print_error()   { echo -e "${RED}✗${RESET} ${RED}$1${RESET}"; }

# perf
if ! command -v perf >/dev/null 2>&1; then
    print_error "perf not installed"
    exit 1
fi
PERF_LINE=$(perf --version 2>/dev/null | head -n1)
print_success "$PERF_LINE"

# Silent kernel tweaks (best-effort)
{ echo -1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || true; } || true
echo 4096 > /proc/sys/kernel/perf_event_mlock_kb 2>/dev/null || true
echo 0 > /proc/sys/kernel/kptr_restrict 2>/dev/null || true

# Required binary utils
for tool in objdump readelf file; do
    command -v "$tool" >/dev/null 2>&1 || { print_error "$tool not found"; exit 1; }
done

# Summary
PERF_VER=$(perf --version 2>/dev/null | awk '{print $3}')
SUMMARY_MSG="Environment set up complete! | perf: ${PERF_VER}"
print_success "$SUMMARY_MSG"
