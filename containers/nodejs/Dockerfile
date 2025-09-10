# uniprof Node.js Profiler Container
# This container provides a consistent environment for Node.js profiling with 0x
# Supports multiple Node.js versions via nvm and multiple package managers
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    curl \
    gcc \
    g++ \
    make \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install nvm (Node Version Manager)
# Using the official nvm installation script
ENV NVM_DIR="/root/.nvm"
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Make nvm available in bash by default
RUN echo 'export NVM_DIR="/root/.nvm"' >> /root/.bashrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /root/.bashrc

# Create directories for caching
RUN mkdir -p /root/.nvm/versions /root/.nvm/.cache


# Copy the bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Set working directory
WORKDIR /workspace

# Set environment variables
# Include Node.js versions in PATH
ENV PATH="/root/.nvm/versions/node/default/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# NVM needs these for proper operation
ENV NODE_VERSION=""

# The container will be run with the user's code mounted at /workspace
# The bootstrap script will be run first to set up the Node.js environment
# Then 0x will be invoked to profile the application