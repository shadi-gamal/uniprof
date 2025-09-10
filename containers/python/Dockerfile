# uniprof Python Profiler Container
# This container provides a consistent environment for Python profiling with py-spy
# Using Ubuntu as base for better ARM64 compatibility
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    gcc \
    g++ \
    libc6-dev \
    libffi-dev \
    libssl-dev \
    libunwind-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy uv and uvx from the official image
# uv is a fast Python package installer and resolver
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Create symlinks to ensure uv is accessible
RUN ln -sf /bin/uv /usr/local/bin/uv && \
    ln -sf /bin/uvx /usr/local/bin/uvx

# Install Rust and Cargo for py-spy installation
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    . /root/.cargo/env && \
    cargo install py-spy && \
    mv /root/.cargo/bin/py-spy /usr/local/bin/py-spy && \
    rm -rf /root/.cargo /root/.rustup

# Copy the bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Set working directory
WORKDIR /workspace

# Set environment variables
# Include common Python tool locations in PATH
# /root/.local/bin is where uv installs Python executables
ENV PATH="/root/.local/bin:/workspace/.venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Set UV_LINK_MODE to copy to avoid hardlink warnings when cache is on different filesystem
ENV UV_LINK_MODE=copy

# Ensure uv and py-spy are executable
RUN chmod +x /usr/local/bin/uv /usr/local/bin/py-spy || true

# The container will be run with the user's code mounted at /workspace
# The bootstrap script will be run first to set up the Python environment
# Then py-spy will be invoked to profile the application