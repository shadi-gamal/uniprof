#!/usr/bin/env bash
# Bootstrap script for setting up JVM environment in the uniprof container

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

if [[ "$COLORS_ENABLED" == "1" ]]; then
    GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; BLUE='\033[34m'; WHITE='\033[37m'; RESET='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; BLUE=''; WHITE=''; RESET=''
fi

print_success() { echo -e "${GREEN}✓${RESET} ${WHITE}$1${RESET}"; }
print_error()   { echo -e "${RED}✗${RESET} ${RED}$1${RESET}"; }

# Java
if command -v java >/dev/null 2>&1; then
    JAVA_VERSION_LINE=$(java -version 2>&1 | head -n1)
    print_success "$JAVA_VERSION_LINE"
else
    print_error "Java is not installed"
    exit 1
fi

# async-profiler requirement
if [ -z "$ASYNC_PROFILER_HOME" ] || [ ! -d "$ASYNC_PROFILER_HOME" ] || [ ! -f "$ASYNC_PROFILER_HOME/lib/libasyncProfiler.so" ]; then
    print_error "async-profiler not available (check ASYNC_PROFILER_HOME)"
    exit 1
fi

# Silent kernel tweaks (best-effort)
{ echo -1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || true; } || true
echo 4096 > /proc/sys/kernel/perf_event_mlock_kb 2>/dev/null || true
echo 0 > /proc/sys/kernel/kptr_restrict 2>/dev/null || true

# Summary
JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}')
SUMMARY_MSG="Environment set up complete! | Java: ${JAVA_VER}"
print_success "$SUMMARY_MSG"
