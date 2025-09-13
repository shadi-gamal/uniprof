#!/usr/bin/env bash
# Bootstrap script for setting up Node.js environment in the uniprof container

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

# Colors (aligned with CLI formatter semantics)
if [[ "$COLORS_ENABLED" == "1" ]]; then
    GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; BLUE='\033[34m'; WHITE='\033[37m'; RESET='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; BLUE=''; WHITE=''; RESET=''
fi

print_success() { echo -e "${GREEN}✓${RESET} ${WHITE}$1${RESET}"; }
print_error()   { echo -e "${RED}✗${RESET} ${RED}$1${RESET}"; }

# nvm
export NVM_DIR="/root/.nvm"
export HOME="/root"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi
if ! type nvm >/dev/null 2>&1; then
    print_error "nvm not available"
    exit 1
fi

# Node version
if [ -f ".nvmrc" ]; then
    nvm install >/dev/null 2>&1 && nvm use >/dev/null 2>&1
elif [ -f ".node-version" ]; then
    NODE_VERSION=$(tr -d '\n\r' < .node-version)
    nvm install "$NODE_VERSION" >/dev/null 2>&1 && nvm use "$NODE_VERSION" >/dev/null 2>&1
else
    nvm install node >/dev/null 2>&1 && nvm use node >/dev/null 2>&1
fi

if command -v node >/dev/null 2>&1; then
    print_success "Node $(node --version) | npm $(npm --version)"
else
    print_error "Node.js not installed"
    exit 1
fi

# 0x profiler
if ! command -v 0x >/dev/null 2>&1; then
    npm install -g 0x >/dev/null 2>&1 || true
fi
if ! command -v 0x >/dev/null 2>&1; then
    print_error "0x profiler not available"
    exit 1
fi

# TypeScript tools (install only if TS files exist)
if find . -name "*.ts" -not -path "./node_modules/*" -type f | grep -q .; then
    if ! command -v tsc >/dev/null 2>&1 || ! command -v tsx >/dev/null 2>&1 || ! command -v ts-node >/dev/null 2>&1; then
        npm install -g typescript tsx ts-node >/dev/null 2>&1 || true
    fi
fi

# Dependencies
PACKAGE_MANAGER_USED=""
if [ -f "pnpm-workspace.yaml" ] || [ -f ".pnpmfile.cjs" ] || [ -f "pnpm-lock.yaml" ]; then
    npm install -g pnpm@latest-10 >/dev/null 2>&1 || true
    pnpm install
    PACKAGE_MANAGER_USED="pnpm"
elif [ -f "yarn.lock" ] || [ -f ".yarnrc" ] || [ -f ".yarnrc.yml" ]; then
    npm install -g yarn >/dev/null 2>&1 || true
    yarn install
    PACKAGE_MANAGER_USED="yarn"
elif [ -f "package.json" ]; then
    npm install
    PACKAGE_MANAGER_USED="npm"
fi
if [ -n "$PACKAGE_MANAGER_USED" ]; then
    print_success "Installed dependencies with $PACKAGE_MANAGER_USED"
fi

# Versions for summary
NODE_VER=$(node --version 2>/dev/null)
NPM_VER=$(npm --version 2>/dev/null)
OX_VER=$(0x --version 2>/dev/null || true)

SUMMARY_MSG="Environment set up complete!"
if [[ -n "$NODE_VER" ]]; then SUMMARY_MSG+=" | Node: ${NODE_VER}"; fi
if [[ -n "$NPM_VER" ]]; then SUMMARY_MSG+=" | npm: ${NPM_VER}"; fi
if [[ -n "$OX_VER" ]]; then SUMMARY_MSG+=" | 0x: ${OX_VER}"; fi
print_success "$SUMMARY_MSG"
