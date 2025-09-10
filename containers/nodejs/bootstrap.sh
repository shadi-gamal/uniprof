#!/usr/bin/env bash
# Bootstrap script for setting up Node.js environment in the uniprof container
# This script handles various Node.js project configurations automatically

set -e  # Exit on error
set -o pipefail  # Exit on pipe failure

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
    echo -e "${BOLD}${BLUE}=== uniprof Node.js Bootstrap ===${RESET}"
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

# Set up environment for nvm
export NVM_DIR="/root/.nvm"
export HOME="/root"

# NVM Setup
print_section "NVM Configuration"

# Source nvm with error handling
if [ -s "$NVM_DIR/nvm.sh" ]; then
    print_step "Loading nvm..."
    # Temporarily disable exit on error for nvm sourcing
    set +e
    source "$NVM_DIR/nvm.sh" 2>&1
    NVM_LOAD_STATUS=$?
    set -e
    
    if [ $NVM_LOAD_STATUS -ne 0 ]; then
        print_warning "nvm returned non-zero exit code: $NVM_LOAD_STATUS"
        # Try to continue anyway as nvm might still work
    fi
    
    # Verify nvm is available
    if ! type nvm &> /dev/null; then
        print_warning "nvm command not available after sourcing"
        exit 1
    fi
    print_success "nvm loaded successfully"
else
    print_warning "nvm.sh not found or empty at $NVM_DIR/nvm.sh"
    print_info "Checking NVM_DIR contents:"
    ls -la "$NVM_DIR" || print_info "NVM_DIR does not exist"
    exit 1
fi

# Install appropriate Node.js version
print_section "Node.js Installation"
print_step "Determining Node.js version..."

if [ -f ".nvmrc" ]; then
    print_info "Found .nvmrc file"
    nvm install
    nvm use
elif [ -f ".node-version" ]; then
    print_info "Found .node-version file"
    NODE_VERSION=$(cat .node-version | tr -d '\n\r')
    print_info "Installing Node.js version: $NODE_VERSION"
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
else
    print_info "No Node.js version file found, installing latest"
    nvm install node
    nvm use node
fi

# Display installed Node.js version
print_success "Using Node.js $(node --version) with npm $(npm --version)"

# Install 0x profiler globally if not already installed
print_section "Profiler Setup"
if ! command -v 0x &> /dev/null; then
    print_step "Installing 0x profiler..."
    npm install -g 0x > /dev/null 2>&1
    print_success "0x profiler installed"
else
    print_success "0x profiler already installed"
fi

# Check for TypeScript files (excluding node_modules)
if find . -name "*.ts" -not -path "./node_modules/*" -type f | grep -q .; then
    # Check if TypeScript tools are already installed
    TS_TOOLS_NEEDED=0
    if ! command -v tsc &> /dev/null; then
        TS_TOOLS_NEEDED=1
    fi
    if ! command -v tsx &> /dev/null; then
        TS_TOOLS_NEEDED=1
    fi
    if ! command -v ts-node &> /dev/null; then
        TS_TOOLS_NEEDED=1
    fi
    
    if [ $TS_TOOLS_NEEDED -eq 1 ]; then
        print_step "Installing TypeScript tools..."
        npm install -g typescript tsx ts-node > /dev/null 2>&1
        print_success "TypeScript tools installed"
    else
        print_success "TypeScript tools already installed"
    fi
fi

# Detect package manager and install dependencies
print_section "Dependency Management"
PACKAGE_MANAGER_USED=""

# Check for pnpm
if [ -f "pnpm-workspace.yaml" ] || [ -f ".pnpmfile.cjs" ] || [ -f "pnpm-lock.yaml" ]; then
    print_info "Found pnpm configuration"
    print_step "Installing pnpm..."
    npm install -g pnpm@latest-10 > /dev/null 2>&1
    print_success "pnpm installed"
    print_step "Installing dependencies..."
    pnpm install
    PACKAGE_MANAGER_USED="pnpm"
fi

# Check for yarn (if not already handled by pnpm)
if [ -z "$PACKAGE_MANAGER_USED" ]; then
    if [ -f "yarn.lock" ] || [ -f ".yarnrc" ] || [ -f ".yarnrc.yml" ]; then
        print_info "Found yarn configuration"
        print_step "Installing yarn..."
        npm install -g yarn > /dev/null 2>&1
        print_success "yarn installed"
        print_step "Installing dependencies..."
        yarn install
        PACKAGE_MANAGER_USED="yarn"
    fi
fi


# Default to npm if no other package manager was used
if [ -z "$PACKAGE_MANAGER_USED" ]; then
    if [ -f "package.json" ]; then
        print_info "Found package.json"
        print_step "Installing dependencies..."
        npm install
        PACKAGE_MANAGER_USED="npm"
    else
        print_info "No package.json found - skipping dependency installation"
    fi
fi

echo
print_success "Environment setup complete!"
if [ -n "$PACKAGE_MANAGER_USED" ]; then
    print_info "Package manager: $PACKAGE_MANAGER_USED"
fi
echo