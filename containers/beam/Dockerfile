# --------  Builder stage  --------
FROM ubuntu:22.04 AS builder
ARG DEBIAN_FRONTEND=noninteractive
ARG KERNEL_VERSION=6.16

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget xz-utils ca-certificates \
    # toolchain
    build-essential clang llvm llvm-dev pkg-config flex bison \
    # core perf deps
    libelf-dev libdw-dev libunwind-dev zlib1g-dev libzstd-dev \
    libcap-dev libslang2-dev libnuma-dev libaudit-dev \
    libpfm4-dev binutils-dev libiberty-dev libcapstone-dev \
    # tracing / unwind / feature libs
    libtraceevent-dev  libtracefs-dev \
    libssl-dev          systemtap-sdt-dev \
    libperl-dev         python3-dev python3-setuptools \
    libbabeltrace-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN wget -O linux.tar.xz https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VERSION}.tar.xz \
    && tar -xf linux.tar.xz && rm linux.tar.xz

WORKDIR /src/linux-${KERNEL_VERSION}/tools/perf
# No extra knobs needed – perf enables everything it finds.
RUN make -j"$(nproc)" WERROR=0 prefix=/usr
RUN make install DESTDIR=/opt/perf-root prefix=/usr
# quick sanity‑check
RUN /opt/perf-root/usr/bin/perf --version

# --------  Runtime stage  --------
FROM ubuntu:22.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    # ─ perf runtime libs ──────────────────────────────────────────────────
    libelf1 libdw1 libunwind8 zlib1g libzstd1 \
    libcap2 libslang2 libnuma1 libaudit1 libpfm4 \
    libssl3 libtraceevent1 libtracefs1 libbabeltrace1 \
    libpython3.10 libperl5.34 libcapstone4 \
    # ─ development tool‑chain ────────────────────────────────────────────
    build-essential clang llvm cmake pkg-config \
    # ─ symbol resolution tools ───────────────────────────────────────────
    binutils elfutils \
    # ─ bootstrap script requirements ─────────────────────────────────────
    file curl git wget \
    # ─ Basic tools for package installation ──────────────────────────────
    gnupg software-properties-common \
    # ─ Erlang/Elixir dependencies ────────────────────────────────────────
    libncurses5-dev libwxgtk3.0-gtk3-dev libgl1-mesa-dev \
    libglu1-mesa-dev libpng-dev libssh-dev unixodbc-dev \
    xsltproc fop libxml2-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy perf from builder
COPY --from=builder /opt/perf-root/ /

# Install Erlang and Elixir from RabbitMQ PPA
RUN add-apt-repository -y ppa:rabbitmq/rabbitmq-erlang \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        erlang \
        elixir \
    && rm -rf /var/lib/apt/lists/*

# Install Rebar3
RUN wget https://github.com/erlang/rebar3/releases/latest/download/rebar3 \
    && chmod +x rebar3 \
    && mv rebar3 /usr/local/bin/

# Install Hex package manager for Elixir
RUN mix local.hex --force \
    && mix local.rebar --force

# Copy helper scripts
COPY bootstrap.sh /usr/local/bin/bootstrap.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/bootstrap.sh

# Set working directory
WORKDIR /workspace

# Enable JIT support environment variables
ENV ERLC_USE_SERVER=true
ENV ERL_FLAGS="+JPperf true"

# Default command
CMD ["/bin/bash"]