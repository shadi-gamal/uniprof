#!/usr/bin/env bash
# Bootstrap script for setting up Ruby environment in the uniprof container
# This script handles Ruby version management and dependency installation

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
    echo -e "${BOLD}${BLUE}=== uniprof Ruby Bootstrap ===${RESET}"
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

# rbenv Configuration
print_section "rbenv Configuration"

# Check if we have a cache directory with rbenv already set up
if [ -d "/cache/rbenv/bin" ] && [ -d "/cache/rbenv/plugins" ]; then
    print_info "Using cached rbenv installation"
    export RBENV_ROOT=/cache/rbenv
else
    print_info "Using container rbenv installation"
    export RBENV_ROOT=/usr/local/rbenv
    
    # If cache directory exists but is empty, copy rbenv to it
    if [ -d "/cache/rbenv" ]; then
        print_step "Initializing rbenv cache..."
        cp -r $RBENV_ROOT/* /cache/rbenv/
        export RBENV_ROOT=/cache/rbenv
        print_success "rbenv cache initialized"
    fi
fi

# Update PATH with the correct RBENV_ROOT
export PATH="$RBENV_ROOT/bin:$RBENV_ROOT/shims:$PATH"

# Initialize rbenv
print_step "Initializing rbenv..."
eval "$(rbenv init -)"
print_success "rbenv initialized"

# Ruby Installation
print_section "Ruby Installation"
print_step "Determining Ruby version..."

# Determine which Ruby to use
if [ -f ".ruby-version" ]; then
    RUBY_VERSION=$(cat .ruby-version | tr -d '[:space:]')
    print_info "Found .ruby-version file: ${RUBY_VERSION}"
else
    # Get the latest stable Ruby version without dashes
    RUBY_VERSION=$(rbenv install -l 2>/dev/null | grep -E '^\s*[0-9]+\.[0-9]+\.[0-9]+\s*$' | tail -1 | tr -d '[:space:]')
    print_info "Using latest Ruby version: ${RUBY_VERSION}"
fi

# Check if Ruby is already installed
if rbenv versions --bare | grep -q "^${RUBY_VERSION}$"; then
    print_success "Ruby ${RUBY_VERSION} is already available"
else
    print_step "Installing Ruby ${RUBY_VERSION}..."
    rbenv install ${RUBY_VERSION}
    print_success "Ruby ${RUBY_VERSION} installed"
fi

# Set the Ruby version for this session
print_step "Setting Ruby version..."
rbenv global ${RUBY_VERSION}
rbenv rehash
print_success "Ruby $(ruby --version)"

# Dependency Management
print_section "Dependency Management"

# Check for Gemfile
if [ -f "Gemfile" ] || [ -f "Gemfile.lock" ]; then
    print_info "Found Gemfile"
    
    # Install bundler if not already installed
    if ! gem list bundler -i > /dev/null 2>&1; then
        print_step "Installing bundler..."
        gem install bundler > /dev/null 2>&1
        rbenv rehash
        print_success "bundler installed"
    fi
    
    # Try to set up vendor/bundle caching
    if [ -d "/workspace/vendor/bundle" ] || mkdir -p /workspace/vendor/bundle 2>/dev/null; then
        if [ -w "/workspace/vendor/bundle" ]; then
            print_step "Configuring bundler cache..."
            bundle config set --local path 'vendor/bundle' > /dev/null 2>&1
            bundle config set --local cache_all true > /dev/null 2>&1
            print_success "bundler cache configured"
        else
            print_warning "vendor/bundle exists but is not writable, using default configuration"
        fi
    else
        print_info "Using default bundler configuration"
    fi
    
    # Run bundle install
    print_step "Installing dependencies..."
    bundle install
    print_success "Dependencies installed"
else
    print_info "No Gemfile found - skipping dependency installation"
fi

echo
print_success "Environment setup complete!"
print_info "Ruby: $(ruby --version)"
print_info "Gem home: $(gem env home)"
echo