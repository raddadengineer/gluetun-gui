# Security policy

## Supported versions

Security-sensitive fixes are applied to the **default branch** and published via updated **Docker Hub** images (`raddadengineer/gluetun-gui`) when applicable. Use `docker compose pull` to stay current.

## Reporting a vulnerability

Please **do not** open a public issue for undisclosed security problems.

1. Open a **[GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)** (private report) against this repository, **or**
2. If GitHub advisories are unavailable, contact the maintainers through the contact method shown on the repository profile / Docker Hub maintainer page.

Include:

- A short description of the issue and its impact
- Steps to reproduce (or a proof-of-concept) if safe to share
- Affected component (UI, API, Docker integration, etc.)

We aim to acknowledge reports within a few days; timelines for fixes depend on severity and complexity.

## Scope notes

- The GUI is intended for **trusted networks** unless you terminate TLS at a reverse proxy (see **[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)**).
- Mounting **`/var/run/docker.sock`** grants the container **full control of the Docker engine** on that host — treat the GUI container and its credentials accordingly.
