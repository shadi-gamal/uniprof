#!/usr/bin/env bash
# Bootstrap script for setting up .NET environment in the uniprof container

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

# .NET SDK
if command -v dotnet >/dev/null 2>&1; then
    DOTNET_VERSION=$(dotnet --version)
    print_success ".NET SDK v${DOTNET_VERSION}"
else
    print_error ".NET SDK is not installed"
    exit 1
fi

# dotnet-trace
if ! command -v dotnet-trace >/dev/null 2>&1; then
    print_error "dotnet-trace is not installed"
    exit 1
fi
TRACE_VERSION=$(dotnet-trace --version 2>&1 | head -n1 | awk '{print $NF}')

# Summary
SUMMARY_MSG="Environment set up complete! | .NET: ${DOTNET_VERSION}"
if [[ -n "$TRACE_VERSION" ]]; then SUMMARY_MSG+=" | dotnet-trace: ${TRACE_VERSION}"; fi
print_success "$SUMMARY_MSG"
