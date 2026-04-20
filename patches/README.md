# Patches

This folder contains build-time patches applied to upstream projects.

## `pia-wg-config-legacy-cn-fallback.patch`

**Target project:** `Ephemeral-Dust/pia-wg-config` (Go)

**Why this exists**

Some environments fail to obtain a PIA WireGuard token due to a TLS validation error against the legacy token endpoint:

- `x509: certificate relies on legacy Common Name field, use SANs instead`

When that happens, PIA’s legacy endpoint is using a certificate pattern newer Go versions reject. Without this patch, `pia-wg-config` exits and the GUI cannot generate `wg0.conf`.

**What the patch changes**

- **Detects the legacy-CN TLS error** and retries token generation.
- **Retries via the alternate public token endpoint**:
  - `https://www.privateinternetaccess.com/api/client/v2/token`
- Uses the correct method and body for the alternate endpoint:
  - **HTTP POST**
  - `Content-Type: application/json`
  - JSON body: `{ "username": "...", "password": "..." }`
- **TLS trust behavior** for the alternate endpoint:
  - uses **system root CAs** (public endpoint), and also appends the downloaded PIA CA bundle
  - avoids the “`certificate signed by unknown authority`” failure that occurs if the system trust store is replaced

**How it is applied**

The root `Dockerfile` builds a `pia-wg-config` binary in a Go builder stage by:

1. cloning the upstream repo
2. applying this patch with `git apply`
3. running `go build`

See `Dockerfile` (stage `go-builder`) for the exact steps.

**Operational notes**

- The GUI logs a line when the retry path is used:
  - `Token request failed with legacy-CN TLS error; retrying via https://www.privateinternetaccess.com/api/client/v2/token`
- This patch only affects **token generation retry** behavior; it does not change region selection or WireGuard server selection logic.

