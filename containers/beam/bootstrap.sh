#!/bin/bash
# uniprof BEAM VM (Erlang/Elixir) profiling container bootstrap script

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

info "Bootstrapping uniprof BEAM VM profiling environment..."

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

# Verify BEAM VM tools are available
info "Checking BEAM VM environment..."

if command -v erl &> /dev/null; then
    ERL_VERSION=$(erl -eval 'io:format("~s", [erlang:system_info(otp_release)]), halt().' -noshell 2>/dev/null || echo "unknown")
    success "Erlang/OTP version: ${ERL_VERSION}"
else
    error "Erlang is not installed"
    exit 1
fi

if command -v elixir &> /dev/null; then
    ELIXIR_VERSION=$(elixir --version 2>/dev/null | grep "Elixir" | cut -d' ' -f2 || echo "unknown")
    success "Elixir version: ${ELIXIR_VERSION}"
else
    warning "Elixir is not installed"
fi

if command -v mix &> /dev/null; then
    success "Mix (Elixir build tool) is available"
else
    warning "Mix is not available"
fi

if command -v rebar3 &> /dev/null; then
    REBAR3_VERSION=$(rebar3 version 2>/dev/null | head -1 || echo "unknown")
    success "Rebar3 version: ${REBAR3_VERSION}"
else
    warning "Rebar3 is not installed"
fi


# Handle Elixir projects (mix.exs)
if [[ -f "mix.exs" ]]; then
    info "Detected Elixir project (mix.exs found)"
    
    # Check if deps directory exists or deps need to be fetched
    if [[ ! -d "deps" ]] || [[ ! -d "_build" ]]; then
        info "Installing dependencies with mix..."
        mix deps.get || warning "Failed to fetch dependencies"
    else
        info "Dependencies directory exists, skipping fetch"
    fi
    
    # Compile the project
    info "Compiling Elixir project..."
    mix compile || warning "Failed to compile project"
    
    success "Elixir project setup complete"

# Handle Erlang projects with rebar.config
elif [[ -f "rebar.config" ]]; then
    info "Detected Erlang project (rebar.config found)"
    
    # Check if _build directory exists or deps need to be fetched
    if [[ ! -d "_build" ]]; then
        info "Installing dependencies with rebar3..."
        rebar3 get-deps || warning "Failed to fetch dependencies"
    else
        info "Build directory exists, skipping dependency fetch"
    fi
    
    # Compile the project
    info "Compiling Erlang project..."
    rebar3 compile || warning "Failed to compile project"
    
    success "Erlang project setup complete"

# Handle Erlang projects with Makefile
elif [[ -f "Makefile" ]] && grep -q "erlc\|erl" Makefile 2>/dev/null; then
    info "Detected Erlang project with Makefile"
    
    # Try to run make
    info "Running make..."
    make || warning "Failed to run make"
    
    success "Makefile-based project setup complete"

else
    info "No BEAM VM project files detected in current directory"
fi

# Verify JIT support and perf integration
info "Checking Erlang VM JIT and perf support..."
if erl -noshell -eval 'case erlang:system_info(jit) of true -> io:format("JIT enabled~n"); _ -> io:format("JIT disabled~n") end, halt().' 2>/dev/null | grep -q "JIT enabled"; then
    success "Erlang JIT is enabled"
else
    warning "Erlang JIT is disabled - profiling may be less accurate"
fi

# Note about ERL_FLAGS
info "Note: ERL_FLAGS=\"+JPperf true\" will be automatically set during profiling"
info "This enables perf integration for the Erlang VM"

success "BEAM VM profiling environment ready"

info "Example usage:"
printf "  ${BOLD}uniprof record -o profile.json -- elixir my_script.exs${NC}\n"
printf "  ${BOLD}uniprof record -o profile.json -- mix run --no-halt${NC}\n"
printf "  ${BOLD}uniprof record -o profile.json -- erl -noshell -s my_module start${NC}\n"
printf "  ${BOLD}uniprof analyze profile.json${NC}\n"