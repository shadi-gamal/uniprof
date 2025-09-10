# uniprof JVM Profiler Container
# This container provides a consistent environment for JVM profiling with async-profiler
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
    && rm -rf /var/lib/apt/lists/*

# Install SDKMAN
RUN curl -s "https://get.sdkman.io" | bash

# Source SDKMAN and install Java, Maven, and Gradle
RUN bash -c "source /root/.sdkman/bin/sdkman-init.sh && \
    sdk install java 24.0.2-open && \
    sdk install maven && \
    sdk install gradle"

# Set JAVA_HOME and update PATH
ENV JAVA_HOME=/root/.sdkman/candidates/java/current
ENV MAVEN_HOME=/root/.sdkman/candidates/maven/current
ENV GRADLE_HOME=/root/.sdkman/candidates/gradle/current
ENV PATH="${JAVA_HOME}/bin:${MAVEN_HOME}/bin:${GRADLE_HOME}/bin:${PATH}"

# Install async-profiler based on architecture
ARG TARGETARCH
RUN if [ "${TARGETARCH}" = "amd64" ]; then \
        ASYNC_PROFILER_URL="https://github.com/async-profiler/async-profiler/releases/download/v4.1/async-profiler-4.1-linux-x64.tar.gz"; \
    elif [ "${TARGETARCH}" = "arm64" ]; then \
        ASYNC_PROFILER_URL="https://github.com/async-profiler/async-profiler/releases/download/v4.1/async-profiler-4.1-linux-arm64.tar.gz"; \
    else \
        echo "Unsupported architecture: ${TARGETARCH}" && exit 1; \
    fi && \
    cd /opt && \
    wget -q "${ASYNC_PROFILER_URL}" -O async-profiler.tar.gz && \
    tar -xzf async-profiler.tar.gz && \
    rm async-profiler.tar.gz && \
    mv async-profiler-* async-profiler && \
    chmod +x /opt/async-profiler/bin/* || true

# Set environment variables for async-profiler
ENV ASYNC_PROFILER_HOME=/opt/async-profiler

# Copy the bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Set working directory
WORKDIR /workspace

# Set environment variables
ENV PATH="/usr/local/bin:${PATH}"

# The container will be run with the user's code mounted at /workspace
# The bootstrap script will be run first to set up the environment
# Then async-profiler will be invoked as a Java agent to profile the application