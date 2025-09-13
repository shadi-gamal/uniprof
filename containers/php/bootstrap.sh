#!/usr/bin/env bash
# Bootstrap script for setting up PHP environment in the uniprof container

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

# PHP
if command -v php >/dev/null 2>&1; then
    PHP_VERSION_LINE=$(php -v | head -n 1)
    print_success "$PHP_VERSION_LINE"
else
    print_error "PHP is not installed"
    exit 1
fi

# Required extension
if ! php -m | grep -qi excimer; then
    print_error "Required PHP extension 'excimer' is not loaded"
    exit 1
fi

# Dependencies (silent unless we actually install)
if [ -f "composer.json" ]; then
    if ! command -v composer >/dev/null 2>&1; then
        print_error "composer not installed but composer.json present"
        exit 1
    fi
    composer install --no-interaction --prefer-dist --no-progress >/dev/null 2>&1
    print_success "Installed Composer dependencies"
fi

# Final summary (single line)
PHP_VER=$(php -v | head -n1 | awk '{print $2}')
if command -v composer >/dev/null 2>&1; then
    COMPOSER_VER=$(composer --version 2>/dev/null | awk '{print $3}')
else
    COMPOSER_VER=""
fi

SUMMARY_MSG="Environment set up complete! | PHP: ${PHP_VER}"
if [[ -n "$COMPOSER_VER" ]]; then SUMMARY_MSG+=" | Composer: ${COMPOSER_VER}"; fi
print_success "$SUMMARY_MSG"
