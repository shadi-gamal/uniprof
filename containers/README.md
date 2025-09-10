# Container Build System

This directory contains Docker containers for each supported platform profiler and the build script to manage them.

## Building Containers

Use `build_containers.py` to build and manage profiler containers:

```bash
# Build a single platform container
uv run containers/build_containers.py python

# Build and push to registry
uv run containers/build_containers.py python --push

# Build all platform containers
uv run containers/build_containers.py all --push
```

## Command-Line Options

### Positional Arguments

- `platform` - Platform to build container for
  - Options: `python`, `nodejs`, `ruby`, `php`, `native`, `beam`, `jvm`, `dotnet`, `all`
  - Use `all` to build containers for all platforms

### Optional Arguments

- `--push` - Push built images to GitHub Container Registry (ghcr.io/indragiek/uniprof)
- `--tag TAG` - Docker image tag (default: `latest`)
- `--skip-cleanup` - Skip removing existing containers and images before building
- `--update-docker-utils` - Update docker.ts to specify platform when pulling images

## Examples

```bash
# Build Python container with default tag
uv run containers/build_containers.py python

# Build and push with custom tag
uv run containers/build_containers.py python --push --tag v1.0.0

# Build all containers and push to registry
uv run containers/build_containers.py all --push

# Build without cleaning up existing images
uv run containers/build_containers.py ruby --skip-cleanup
```

## Platform Containers

Each platform has its own directory with a Dockerfile and optional bootstrap script:

- `python/` - Python with py-spy profiler
- `nodejs/` - Node.js with 0x profiler
- `ruby/` - Ruby with rbspy profiler
- `php/` - PHP with Excimer profiler
- `native/` - Linux perf for native binaries
- `beam/` - BEAM VM (Erlang/Elixir) with perf
- `jvm/` - JVM with async-profiler
- `dotnet/` - .NET with dotnet-trace

## Multi-Architecture Support

The build script automatically builds for both `linux/amd64` and `linux/arm64` architectures using Docker buildx.

## Requirements

- Docker with buildx support (included in Docker Desktop)
- Push access to ghcr.io/indragiek/uniprof (for `--push` option)
