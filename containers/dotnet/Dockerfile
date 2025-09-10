# uniprof .NET Profiler Container
# This container provides a consistent environment for .NET profiling with dotnet-trace
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    curl \
    wget \
    zip \
    unzip \
    tar \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install .NET SDK 10 (preview channel) using Microsoft's installation script
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 10.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet

# Set .NET environment variables
ENV DOTNET_ROOT="/usr/share/dotnet"
ENV PATH="${DOTNET_ROOT}:${PATH}"

# Install dotnet-trace global tool
RUN dotnet tool install --global dotnet-trace

# Set PATH to include .NET tools
ENV PATH="/root/.dotnet/tools:${PATH}"

# Copy the bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Set working directory
WORKDIR /workspace

# Set environment variables
ENV PATH="/usr/local/bin:${PATH}"

# The container will be run with the user's code mounted at /workspace
# The bootstrap script will be run first to set up the environment
# Then dotnet-trace will be invoked to profile the application