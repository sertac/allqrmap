# Stage 1: Build the backend
FROM rust:1.86-slim-bookworm as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libsqlite3-dev && rm -rf /var/lib/apt/lists/*

# Copy the source code
COPY . .

# Build the application
# Use CARGO_BUILD_JOBS=1 to prevent memory exhaustion on Render Free Tier
ENV CARGO_BUILD_JOBS=1
RUN cargo build --release --locked

# Stage 2: Create the runtime image
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y ca-certificates libsqlite3-0 && rm -rf /var/lib/apt/lists/*

# Copy the binary from the builder
COPY --from=builder /app/target/release/allqrmap /app/allqrmap

# Copy the static files
COPY --from=builder /app/static /app/static

# Expose the port
EXPOSE 3000

# Run the application
CMD ["./allqrmap"]
