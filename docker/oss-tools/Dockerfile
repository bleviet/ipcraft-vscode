FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    make \
    g++ \
    ghdl \
    iverilog \
    verilator \
    libxml2-utils \
    python3 \
    python3-pip \
    python3-venv \
    xvfb \
    chromium-browser \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir cocotb pytest

RUN npx playwright install --with-deps chromium

WORKDIR /work
