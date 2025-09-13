#!/usr/bin/env bash
# Bootstrap script for setting up BEAM (Erlang/Elixir) environment in the uniprof container

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
    GREEN='\033[32m'
    YELLOW='\033[33m'
    RED='\033[31m'
    BLUE='\033[34m'
    WHITE='\033[37m'
    RESET='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; BLUE=''; WHITE=''; RESET=''
fi

# Minimal helpers (✓ message in white; ✗ message in red)
print_success() { echo -e "${GREEN}✓${RESET} ${WHITE}$1${RESET}"; }
print_error()   { echo -e "${RED}✗${RESET} ${RED}$1${RESET}"; }

# perf (required on Linux for BEAM perf integration)
if ! command -v perf >/dev/null 2>&1; then
    print_error "perf not installed"
    exit 1
fi

# Silent kernel tweaks (best-effort)
{ echo -1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || true; } || true
echo 4096 > /proc/sys/kernel/perf_event_mlock_kb 2>/dev/null || true
echo 0 > /proc/sys/kernel/kptr_restrict 2>/dev/null || true

# Erlang / Elixir
if command -v erl >/dev/null 2>&1; then
    ERL_VERSION=$(erl -eval 'io:format("~s", [erlang:system_info(otp_release)]), halt().' -noshell 2>/dev/null || echo "unknown")
    print_success "Erlang/OTP ${ERL_VERSION}"
else
    print_error "Erlang is not installed"
    exit 1
fi
if command -v elixir >/dev/null 2>&1; then
    ELIXIR_VERSION=$(elixir --version 2>/dev/null | awk '/Elixir/ {print $2}')
    print_success "Elixir ${ELIXIR_VERSION}"
fi

# Project setup (silent unless action taken)
if [[ -f "mix.exs" ]]; then
    [[ -d deps && -d _build ]] || mix deps.get >/dev/null 2>&1 || true
    mix compile >/dev/null 2>&1 || true
    print_success "Elixir project prepared"
elif [[ -f "rebar.config" ]]; then
    [[ -d _build ]] || rebar3 get-deps >/dev/null 2>&1 || true
    rebar3 compile >/dev/null 2>&1 || true
    print_success "Erlang project prepared"
elif [[ -f "Makefile" ]] && grep -q "erlc\|erl" Makefile 2>/dev/null; then
    make >/dev/null 2>&1 || true
    print_success "Makefile project prepared"
fi

# Summary line
SUMMARY_MSG="Environment set up complete! | Erlang: ${ERL_VERSION}"
if [[ -n "${ELIXIR_VERSION:-}" ]]; then SUMMARY_MSG+=" | Elixir: ${ELIXIR_VERSION}"; fi
print_success "$SUMMARY_MSG"
