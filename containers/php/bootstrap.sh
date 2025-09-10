#!/usr/bin/env bash
# Bootstrap script for setting up PHP environment in the uniprof container
# This script handles PHP project configurations automatically

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
    echo -e "${BOLD}${BLUE}=== uniprof PHP Bootstrap ===${RESET}"
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

# PHP Configuration
print_section "PHP Configuration"
print_step "Checking PHP installation..."

# Display PHP version
PHP_VERSION=$(php -v | head -n 1)
print_success "$PHP_VERSION"

# Verify Excimer is loaded
print_step "Verifying Excimer extension..."
if php -m | grep -qi excimer; then
    print_success "Excimer extension is loaded"
else
    print_warning "Excimer extension is not loaded!"
    exit 1
fi

# Dependency Management
print_section "Dependency Management"

# Check for composer.json
if [ -f "composer.json" ]; then
    print_info "Found composer.json"
    print_step "Installing dependencies..."
    
    # Check if vendor directory exists and composer.lock exists
    if [ -f "composer.lock" ] && [ -d "vendor" ]; then
        print_info "Found existing vendor directory and composer.lock"
        print_step "Verifying dependencies are up to date..."
        
        # Check if dependencies are up to date
        if composer install --dry-run 2>&1 | grep -q "Nothing to install"; then
            print_success "Dependencies are up to date"
        else
            composer install --no-interaction --prefer-dist
            print_success "Dependencies updated"
        fi
    else
        # Fresh install
        composer install --no-interaction --prefer-dist
        print_success "Dependencies installed"
    fi
    
    # Show installed packages count
    if [ -f "composer.lock" ]; then
        PACKAGE_COUNT=$(composer show --format=json 2>/dev/null | grep -c '"name"' || echo "0")
        print_info "Installed packages: $PACKAGE_COUNT"
    fi
else
    print_info "No composer.json found - skipping dependency installation"
fi

# Check for common PHP frameworks/tools
print_section "Framework Detection"

if [ -f "artisan" ]; then
    print_info "Laravel application detected"
    if [ -f ".env" ]; then
        print_success "Environment file found"
    else
        print_warning "No .env file found - application may not run properly"
    fi
elif [ -f "symfony.lock" ] || [ -f "bin/console" ]; then
    print_info "Symfony application detected"
elif [ -f "wp-config.php" ] || [ -f "wp-load.php" ]; then
    print_info "WordPress application detected"
elif [ -f "index.php" ] && grep -q "Drupal" index.php 2>/dev/null; then
    print_info "Drupal application detected"
else
    print_info "No specific framework detected"
fi

# Cache configuration for better performance
print_section "Performance Optimization"

# Configure Composer cache
if [ -d "/root/.composer/cache" ]; then
    print_success "Composer cache directory available"
fi

# OPcache status (for CLI, usually disabled, but good to check)
if php -m | grep -qi opcache; then
    print_info "OPcache extension available"
fi

echo
print_success "Environment setup complete!"
print_info "PHP: $(php -v | head -n 1 | cut -d' ' -f2)"
print_info "Composer: $(composer --version 2>/dev/null | cut -d' ' -f3 || echo 'not available')"
echo