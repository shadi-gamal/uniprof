#!/usr/bin/env bash
# Bootstrap script for setting up JVM profiling environment in the uniprof container

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
    echo -e "${BOLD}${BLUE}=== uniprof JVM Bootstrap ===${RESET}"
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

# Verify Java installation
print_section "Java Environment"
print_step "Checking Java installation..."
if command -v java &> /dev/null; then
    JAVA_VERSION=$(java -version 2>&1 | head -n 1)
    print_success "Java is installed: $JAVA_VERSION"
else
    print_error "Java is not installed"
    exit 1
fi

# Verify async-profiler installation
print_section "Async-Profiler Setup"
print_step "Checking async-profiler installation..."
if [ -d "$ASYNC_PROFILER_HOME" ]; then
    print_success "Async-profiler found at: $ASYNC_PROFILER_HOME"
    
    # Check for the required library
    if [ -f "$ASYNC_PROFILER_HOME/lib/libasyncProfiler.so" ]; then
        print_success "libasyncProfiler.so library found"
    else
        print_error "libasyncProfiler.so library not found at $ASYNC_PROFILER_HOME/lib/"
        exit 1
    fi
else
    print_error "Async-profiler not found at $ASYNC_PROFILER_HOME"
    exit 1
fi

# Configure kernel parameters for profiling (same as native bootstrap)
print_section "Kernel Parameters Configuration"

# Set perf_event_paranoid
if [[ -w /proc/sys/kernel/perf_event_paranoid ]]; then
    echo -1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 1 > /proc/sys/kernel/perf_event_paranoid
    print_success "Set perf_event_paranoid=$(cat /proc/sys/kernel/perf_event_paranoid)"
else
    if [[ -r /proc/sys/kernel/perf_event_paranoid ]]; then
        PARANOID_LEVEL=$(cat /proc/sys/kernel/perf_event_paranoid)
        if [[ $PARANOID_LEVEL -gt 1 ]]; then
            print_warning "perf_event_paranoid=$PARANOID_LEVEL (restrictive, may affect profiling)"
        else
            print_info "perf_event_paranoid=$PARANOID_LEVEL (acceptable)"
        fi
    else
        print_warning "Cannot read perf_event_paranoid"
    fi
fi

# Set perf_event_mlock_kb
if [[ -w /proc/sys/kernel/perf_event_mlock_kb ]]; then
    echo 4096 > /proc/sys/kernel/perf_event_mlock_kb
    print_success "Set perf_event_mlock_kb=4096"
else
    print_warning "Cannot modify perf_event_mlock_kb"
fi

# Set kptr_restrict
if [[ -w /proc/sys/kernel/kptr_restrict ]]; then
    echo 0 > /proc/sys/kernel/kptr_restrict
    print_success "Set kptr_restrict=0 (kernel pointers visible)"
else
    if [[ -r /proc/sys/kernel/kptr_restrict ]]; then
        KPTR_RESTRICT=$(cat /proc/sys/kernel/kptr_restrict)
        if [[ $KPTR_RESTRICT -gt 0 ]]; then
            print_warning "kptr_restrict=$KPTR_RESTRICT (kernel pointers hidden)"
        else
            print_info "kptr_restrict=$KPTR_RESTRICT (kernel pointers visible)"
        fi
    else
        print_warning "Cannot read kptr_restrict"
    fi
fi

echo
print_success "JVM profiling environment ready!"
echo