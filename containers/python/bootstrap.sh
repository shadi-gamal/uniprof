#!/usr/bin/env bash
# Bootstrap script for setting up Python environment in the uniprof container
# This script handles various Python project configurations automatically

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
    BOLD='\033[1m'
    RESET='\033[0m'
else
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    RESET=''
fi

# Helper functions
print_header() {
    echo
    echo -e "${BOLD}${BLUE}=== uniprof Python Bootstrap ===${RESET}"
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

print_section() {
    echo
    echo -e "${BOLD}$1${RESET}"
}

# Main script
print_header

# Install Python using uv
print_section "Python Installation"
print_step "Installing Python via uv..."
if uv --preview python install --default 2>/dev/null; then
    print_success "Python installed successfully"
else
    print_warning "Could not install Python via uv, using system Python"
fi

# Virtual Environment Setup
print_section "Virtual Environment"

# Check if virtual environment already exists
if [ -d ".venv" ] && [ -f ".venv/bin/activate" ]; then
    print_info "Found existing virtual environment at .venv"
    print_step "Activating virtual environment..."
    source .venv/bin/activate
    print_success "Virtual environment activated"
else
    # Create virtual environment
    print_step "Creating new virtual environment..."
    if uv venv 2>/dev/null; then
        print_success "Virtual environment created with uv"
    else
        print_warning "Could not create virtual environment with uv"
        # Try with system python as fallback
        if python3 -m venv .venv 2>/dev/null || python -m venv .venv 2>/dev/null; then
            print_success "Virtual environment created with system Python"
        else
            print_warning "Failed to create virtual environment"
        fi
    fi
    
    # Activate the newly created virtual environment
    if [ -f ".venv/bin/activate" ]; then
        print_step "Activating virtual environment..."
        source .venv/bin/activate
        print_success "Virtual environment activated"
    else
        print_warning "Could not activate virtual environment"
    fi
fi

# Dependency Management
print_section "Dependency Management"

# Check for pyproject.toml (modern Python project)
if [ -f "pyproject.toml" ]; then
    print_info "Found pyproject.toml"
    print_step "Syncing dependencies..."
    if uv pip sync pyproject.toml 2>/dev/null; then
        print_success "Dependencies synced successfully"
    else
        print_warning "Failed to sync dependencies"
        exit 1
    fi
    
    echo
    print_success "Environment setup complete!"
    echo
    exit 0
fi

# Check for pylock.toml or pylock.*.toml files
PYLOCK_FILE=""
if [ -f "pylock.toml" ]; then
    PYLOCK_FILE="pylock.toml"
else
    # Look for any pylock.*.toml file
    PYLOCK_FILE=$(find . -maxdepth 1 -name "pylock.*.toml" -type f | head -n1)
fi

if [ -n "$PYLOCK_FILE" ]; then
    print_info "Found lock file: $PYLOCK_FILE"
    print_step "Syncing dependencies..."
    if uv pip sync "$PYLOCK_FILE" 2>/dev/null; then
        print_success "Dependencies synced successfully"
    else
        print_warning "Failed to sync dependencies"
        exit 1
    fi
    
    echo
    print_success "Environment setup complete!"
    echo
    exit 0
fi

# Check for requirements.txt (traditional Python project)
if [ -f "requirements.txt" ]; then
    print_info "Found requirements.txt"
    print_step "Installing dependencies..."
    if uv pip sync requirements.txt 2>/dev/null; then
        print_success "Dependencies installed successfully"
    else
        print_warning "Failed to install dependencies"
        exit 1
    fi
    
    echo
    print_success "Environment setup complete!"
    echo
    exit 0
fi

# No dependency files found
print_info "No dependency files found (pyproject.toml, pylock.toml, or requirements.txt)"
echo
print_success "Environment setup complete!"
echo