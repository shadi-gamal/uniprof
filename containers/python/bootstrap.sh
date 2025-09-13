#!/usr/bin/env bash
# Bootstrap script for setting up Python environment in the uniprof container

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

# Ensure Python via uv (silent best-effort)
uv --preview python install --default >/dev/null 2>&1 || true

# Virtualenv
if [ -d ".venv" ] && [ -f ".venv/bin/activate" ]; then
    # shellcheck source=/dev/null
    source .venv/bin/activate
else
    if uv venv >/dev/null 2>&1 || python3 -m venv .venv >/dev/null 2>&1 || python -m venv .venv >/dev/null 2>&1; then
        # shellcheck source=/dev/null
        source .venv/bin/activate || true
    fi
fi

# Dependencies (silent unless we actually install)
if [ -f "pyproject.toml" ]; then
    uv pip sync pyproject.toml >/dev/null 2>&1 || { print_error "Dependency sync failed (pyproject.toml)"; exit 1; }
    print_success "Installed Python dependencies (pyproject.toml)"
elif [ -f "pylock.toml" ] || ls pylock.*.toml >/dev/null 2>&1; then
    PYLOCK_FILE="pylock.toml"
    [ -f "$PYLOCK_FILE" ] || PYLOCK_FILE=$(ls pylock.*.toml | head -n1)
    uv pip sync "$PYLOCK_FILE" >/dev/null 2>&1 || { print_error "Dependency sync failed ($PYLOCK_FILE)"; exit 1; }
    print_success "Installed Python dependencies ($PYLOCK_FILE)"
elif [ -f "requirements.txt" ]; then
    uv pip sync requirements.txt >/dev/null 2>&1 || { print_error "Dependency install failed (requirements.txt)"; exit 1; }
    print_success "Installed Python dependencies (requirements.txt)"
fi

# Versions for summary
PY_VER=$(python3 -c 'import sys; print("%d.%d.%d"%sys.version_info[:3])' 2>/dev/null || python -V 2>&1 | awk '{print $2}')
PIP_VER=$(python3 -m pip --version 2>/dev/null | awk '{print $2}')
UV_VER=$(uv --version 2>/dev/null | awk '{print $2}')

SUMMARY_MSG="Environment set up complete!"
if [[ -n "$PY_VER" ]]; then SUMMARY_MSG+=" | Python: ${PY_VER}"; fi
if [[ -n "$PIP_VER" ]]; then SUMMARY_MSG+=" | pip: ${PIP_VER}"; fi
if [[ -n "$UV_VER" ]]; then SUMMARY_MSG+=" | uv: ${UV_VER}"; fi
print_success "$SUMMARY_MSG"
