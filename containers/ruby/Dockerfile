FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update package lists and install essential packages
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    libreadline-dev \
    zlib1g-dev \
    libffi-dev \
    libyaml-dev \
    libxml2-dev \
    libxslt1-dev \
    liblzma-dev \
    libncurses5-dev \
    procps \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install rbenv
ENV RBENV_ROOT=/usr/local/rbenv
ENV PATH="$RBENV_ROOT/bin:$RBENV_ROOT/shims:$PATH"

RUN git clone https://github.com/rbenv/rbenv.git $RBENV_ROOT && \
    cd $RBENV_ROOT && src/configure && make -C src && \
    git clone https://github.com/rbenv/ruby-build.git $RBENV_ROOT/plugins/ruby-build

# Install Rust and Cargo for rbspy installation
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install rbspy using cargo
RUN cargo install rbspy && \
    mv /root/.cargo/bin/rbspy /usr/local/bin/rbspy && \
    rm -rf /root/.cargo /root/.rustup

# Set working directory
WORKDIR /workspace

# Copy the bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Default command
CMD ["/bin/bash"]