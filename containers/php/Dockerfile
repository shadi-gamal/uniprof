FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    wget \
    unzip \
    software-properties-common \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Add PHP repository for latest versions
RUN add-apt-repository ppa:ondrej/php -y && \
    apt-get update

# Install PHP 8.4 and development tools
RUN apt-get install -y \
    php8.4-cli \
    php8.4-dev \
    php8.4-mbstring \
    php8.4-xml \
    php8.4-curl \
    php8.4-zip \
    php8.4-bcmath \
    php8.4-intl \
    php8.4-gd \
    php8.4-mysql \
    php8.4-pgsql \
    php8.4-sqlite3 \
    php8.4-redis \
    php-pear \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Build and install Excimer from source
# (PECL package might not be available or up to date)
RUN cd /tmp && \
    git clone https://github.com/wikimedia/mediawiki-php-excimer.git && \
    cd mediawiki-php-excimer && \
    phpize && \
    ./configure && \
    make && \
    make install && \
    cd / && \
    rm -rf /tmp/mediawiki-php-excimer

# Enable Excimer extension
RUN echo "extension=excimer.so" > /etc/php/8.4/mods-available/excimer.ini && \
    phpenmod excimer

# Verify Excimer is installed
RUN php -m | grep -i excimer

# Copy bootstrap script
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

# Create workspace directory
RUN mkdir -p /workspace

WORKDIR /workspace

# Set up a non-root user (optional, but good practice)
# PHP doesn't require root for profiling like some other profilers
RUN useradd -m -s /bin/bash phpuser

# Default to bash
CMD ["/bin/bash"]