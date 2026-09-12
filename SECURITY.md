# Security Policy

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report security issues privately through one of these channels:

- GitHub's [private vulnerability reporting](https://github.com/boelabs/bifrost/security/advisories/new) (preferred).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept.
- Affected versions/commit, if known.

You can expect an acknowledgement within **72 hours** and a status update within **7 days**. We ask
that you give us a reasonable window to ship a fix before any public disclosure.

## Scope and handling of secrets

Bifrost brokers requests to third-party AI providers and stores provider credentials. Keep the
following in mind when reporting or operating:

- Provider credentials, extension sources, and forensic samples are encrypted at rest with
  purpose-bound AES-256-GCM envelopes. `ENCRYPTION_KEYRING` supports online rotation and old-key
  retirement; plaintext secrets are never returned by the admin API.
- The `MASTER_KEY` grants full admin access; treat it as a root credential.
- Never paste real API keys, `.env` contents, or production `DATABASE_URL`/`REDIS_URL` values into an
  issue or PR. Redact them in any report.

## Supported versions

This project is pre-1.0. Security fixes are applied to the `main` branch. Once a stable release line
exists, this section will list the supported versions.
