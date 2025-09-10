#!/bin/bash
# uniprof native profiling container bootstrap script

# Enable POSIX mode and fail on errors
set -euo pipefail

# Color support detection
if [[ -n "${CLICOLORS_FORCE:-}" ]] && [[ "${CLICOLORS_FORCE}" != "0" ]]; then
    COLORS_ENABLED=1
elif [[ -n "${CLICOLORS:-}" ]] && [[ "${CLICOLORS}" == "0" ]]; then
    COLORS_ENABLED=0
elif [[ -t 1 ]]; then
    COLORS_ENABLED=1
else
    COLORS_ENABLED=0
fi

# Color definitions
if [[ $COLORS_ENABLED -eq 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

# Logging functions
info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
}

success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
}

warning() {
    printf "${YELLOW}[WARNING]${NC} %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

info "Bootstrapping uniprof native profiling environment..."

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    warning "Running as non-root user. Some operations may fail."
fi

# Verify perf installation
if ! command -v perf &> /dev/null; then
    error "perf is not installed"
    exit 1
fi

# Check perf version
if perf --version >/dev/null 2>&1; then
    PERF_VERSION=$(perf --version 2>/dev/null | head -1 || echo "version check failed")
    if [[ -z "$PERF_VERSION" ]]; then
        PERF_VERSION="unknown (but functional)"
    fi
    info "perf version: ${PERF_VERSION}"
else
    error "perf not working properly"
    exit 1
fi

# Set kernel parameters for profiling (if possible)
# Try to set perf_event_paranoid to allow user and kernel profiling
if [[ -w /proc/sys/kernel/perf_event_paranoid ]]; then
    echo -1 > /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 1 > /proc/sys/kernel/perf_event_paranoid
    success "Set perf_event_paranoid=$(cat /proc/sys/kernel/perf_event_paranoid)"
else
    # Try to read current value
    if [[ -r /proc/sys/kernel/perf_event_paranoid ]]; then
        PARANOID_LEVEL=$(cat /proc/sys/kernel/perf_event_paranoid)
        if [[ $PARANOID_LEVEL -gt 1 ]]; then
            warning "perf_event_paranoid=$PARANOID_LEVEL (restrictive, may affect symbol resolution)"
        else
            info "perf_event_paranoid=$PARANOID_LEVEL (acceptable)"
        fi
    else
        warning "Cannot read perf_event_paranoid"
    fi
fi

# Try to increase mlock limit for perf
if [[ -w /proc/sys/kernel/perf_event_mlock_kb ]]; then
    echo 4096 > /proc/sys/kernel/perf_event_mlock_kb
    success "Set perf_event_mlock_kb=4096"
else
    warning "Cannot modify perf_event_mlock_kb"
fi

# Try to set kptr_restrict to allow kernel pointer visibility
if [[ -w /proc/sys/kernel/kptr_restrict ]]; then
    echo 0 > /proc/sys/kernel/kptr_restrict
    success "Set kptr_restrict=0 (kernel pointers visible)"
else
    if [[ -r /proc/sys/kernel/kptr_restrict ]]; then
        KPTR_RESTRICT=$(cat /proc/sys/kernel/kptr_restrict)
        if [[ $KPTR_RESTRICT -gt 0 ]]; then
            warning "kptr_restrict=$KPTR_RESTRICT (kernel pointers hidden, may affect symbol resolution)"
        else
            info "kptr_restrict=$KPTR_RESTRICT (kernel pointers visible)"
        fi
    else
        warning "Cannot read kptr_restrict"
    fi
fi

# Verify tools are available
for tool in objdump readelf file; do
    if command -v "$tool" &> /dev/null; then
        success "${tool} is available"
    else
        error "${tool} is not available"
        exit 1
    fi
done

success "Native profiling environment ready"
success "You can now use uniprof to profile native applications"

info "Example usage:"
printf "  ${BOLD}uniprof record -o profile.json -- ./your-native-app${NC}\n"
printf "  ${BOLD}uniprof analyze profile.json${NC}\n"