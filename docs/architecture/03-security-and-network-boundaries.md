# Security & Network Boundaries

Foreman is designed as a local standalone application. Security and network isolation are critical to protect the local development environment from DNS rebinding and cross-site request forgery.

## 1. Local Network Isolation (Loopback-Only)

- **Binding Policy:** The Fastify server binds **strictly** to explicit loopback addresses (`127.0.0.1` for IPv4 and `[::1]` for IPv6 when available).
- **Fail-Closed:** If a configuration or request attempts to bind to a non-loopback interface (e.g., `0.0.0.0`), the server fails closed and refuses to start.

## 2. Request Integrity & Browser Defense

- **Host & Origin Validation:** The server validates incoming `Host` and `Origin` headers against the accepted socket address to prevent DNS-rebinding attacks.
- **CSRF Protection:** Same-origin mutation requests require a timing-safe, in-memory CSRF token paired with a same-origin session cookie.
- **CORS Policy:** Restrictive CORS defaults prevent unauthorized cross-origin web pages from interacting with the local Foreman API.

## 3. Secret Management (`SecretStore`)

- **OS Vault Integration:** On Windows, sensitive tokens/credentials are safely stored in the **Windows Credential Manager**.
- **Process Memory Fallback:** Platforms without native OS vault adapters utilize secure process-memory storage. Credentials are never written in plaintext to config files or databases.
