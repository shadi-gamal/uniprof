#!/usr/bin/env bash
# Bootstrap script for setting up .NET profiling environment in the uniprof container

set -e  # Exit on error

# CLICOLORS support
if [[ -n "$CLICOLORS_FORCE" ]] && [[ "$CLICOLORS_FORCE" != "0" ]]; then
    COLORS_ENABLED=1
elif [[ -n "$CLICOLORS" ]] && [[ "$CLICOLORS" == "0" ]]; then
    COLORS_ENABLED=0
elif [[ -t 1 ]]; then
    # Output is to a terminal
    COLORS_ENABLED=1
else
    COLORS_ENABLED=0
fi

# Color codes
if [[ "$COLORS_ENABLED" == "1" ]]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    RED='\033[0;31m'
    BOLD='\033[1m'
    RESET='\033[0m'
else
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    RED=''
    BOLD=''
    RESET=''
fi

# Helper functions
print_header() {
    echo
    echo -e "${BOLD}${BLUE}=== uniprof .NET Bootstrap ===${RESET}"
    echo
}

print_step() {
    echo -e "${BOLD}${CYAN}==>${RESET} $1"
}

print_info() {
    echo -e "    $1"
}

print_success() {
    echo -e "    ${GREEN}✓${RESET} $1"
}

print_warning() {
    echo -e "    ${YELLOW}!${RESET} $1"
}

print_error() {
    echo -e "    ${RED}✗${RESET} $1"
}

print_section() {
    echo
    echo -e "${BOLD}$1${RESET}"
}

# Main script
print_header

# Verify .NET installation
print_section ".NET Environment"
print_step "Checking .NET installation..."
if command -v dotnet &> /dev/null; then
    DOTNET_VERSION=$(dotnet --version)
    print_success ".NET SDK is installed: v$DOTNET_VERSION"
else
    print_error ".NET SDK is not installed"
    exit 1
fi

# Verify dotnet-trace installation
print_section "dotnet-trace Setup"
print_step "Checking dotnet-trace installation..."
if command -v dotnet-trace &> /dev/null; then
    TRACE_VERSION=$(dotnet-trace --version 2>&1 | head -n 1)
    print_success "dotnet-trace is installed: $TRACE_VERSION"
else
    print_error "dotnet-trace is not installed"
    exit 1
fi


echo
print_success ".NET profiling environment ready!"
echo