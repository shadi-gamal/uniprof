#!/usr/bin/env bash
# Bootstrap script for setting up Ruby environment in the uniprof container

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

# rbenv root
if [ -d "/cache/rbenv/bin" ] && [ -d "/cache/rbenv/plugins" ]; then
    export RBENV_ROOT=/cache/rbenv
else
    export RBENV_ROOT=/usr/local/rbenv
    if [ -d "/cache/rbenv" ]; then
        cp -r "$RBENV_ROOT/"* /cache/rbenv/ >/dev/null 2>&1 || true
        export RBENV_ROOT=/cache/rbenv
    fi
fi
export PATH="$RBENV_ROOT/bin:$RBENV_ROOT/shims:$PATH"

# Initialize rbenv
eval "$(rbenv init -)" >/dev/null 2>&1 || true

# Determine Ruby version
if [ -f ".ruby-version" ]; then
    RUBY_VERSION=$(tr -d '[:space:]' < .ruby-version)
else
    RUBY_VERSION=$(rbenv install -l 2>/dev/null | grep -E '^\s*[0-9]+\.[0-9]+\.[0-9]+\s*$' | tail -1 | tr -d '[:space:]')
fi

# Ensure Ruby installed
if ! rbenv versions --bare | grep -q "^${RUBY_VERSION}$"; then
    rbenv install -s "${RUBY_VERSION}" >/dev/null 2>&1 || { print_error "Failed to install Ruby ${RUBY_VERSION}"; exit 1; }
fi
rbenv global "${RUBY_VERSION}" >/dev/null 2>&1 || true
rbenv rehash >/dev/null 2>&1 || true

# One-line Ruby version success
print_success "$(ruby --version)"

# Dependencies via bundler
if [ -f "Gemfile" ] || [ -f "Gemfile.lock" ]; then
    if ! gem list bundler -i >/dev/null 2>&1; then
        gem install bundler >/dev/null 2>&1 || { print_error "Failed to install bundler"; exit 1; }
        rbenv rehash >/dev/null 2>&1 || true
    fi
    if [ -d "/workspace/vendor/bundle" ] || mkdir -p /workspace/vendor/bundle >/dev/null 2>&1; then
        if [ -w "/workspace/vendor/bundle" ]; then
            bundle config set --local path 'vendor/bundle' >/dev/null 2>&1 || true
            bundle config set --local cache_all true >/dev/null 2>&1 || true
        fi
    fi
    bundle install >/dev/null 2>&1 || { print_error "bundle install failed"; exit 1; }
    print_success "Installed gems with bundler"
fi

# Summary
RUBY_VER=$(ruby -v | awk '{print $2}')
BUNDLER_VER=$(bundle --version 2>/dev/null | awk '{print $3}')
SUMMARY_MSG="Environment set up complete! | Ruby: ${RUBY_VER}"
if [[ -n "$BUNDLER_VER" ]]; then SUMMARY_MSG+=" | Bundler: ${BUNDLER_VER}"; fi
print_success "$SUMMARY_MSG"
