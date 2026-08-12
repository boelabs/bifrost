# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Versioned, purpose-bound AES-256-GCM encryption keyring with authenticated key ids, online batch
  rotation, and encrypted observability sampling without a plaintext/disabled mode.
- Hard streaming JSON body limits, trusted-proxy client-IP resolution, DNS-pinned portable content
  fetches, and request-wide shutdown/content deadlines.
- Atomic TPM/cost reservations for virtual keys and atomic RPM/TPM admission for deployments, with
  exact settlement from provider-reported usage.

- Open-source project scaffolding: MIT `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, GitHub issue/PR templates, and a CI workflow (lint, typecheck, unit + integration
  tests, dependency audit).
- Production `Dockerfile` (multi-stage, non-root, with a container healthcheck) and `.dockerignore`.
- Structured JSON application logger (`src/logging/log.ts`) replacing scattered `console.*` calls.
- Configurable image identity/branding via `IMAGE_BRANDING_PRODUCT` and `IMAGE_BRANDING_OWNER`
  environment variables (previously hardcoded).
- `Setup`, `Deployment` (per-platform: Coolify, Portainer, Dokploy, Docker on Linux), and
  `Known errors` documentation pages.
- Contributor guide for creating provider catalogs and models (the four files to touch, including the
  `validate-catalog` list), in the model-catalog docs and `CONTRIBUTING.md`.

### Changed

- `response_states`, operation retention, extension reload, and video lifecycle maintenance run as
  bounded in-app jobs.
- Repository-wide import sorter (`scripts/sort-imports.ts`) folded into `bun run format` and applied
  across the monorepo.
- Migrated the gateway runtime from Node to **Bun** (dev/start/migrate scripts, the production
  `Dockerfile`, and CI; unit tests run under `bun test`).
- Adopted **drizzle-kit** + Drizzle's migrator for forward-only database migrations; historical
  hand-tuned DDL remains immutable.
- Renamed the project to **Bifrost** (`@boelabs/bifrost`): environment variables
  (`BIFROST_*`), the response-cache headers (`x-unified-cache`), the OpenTelemetry metric
  prefix, and the virtual-key prefix (`unified-`).
- Translated the codebase (comments, internal messages, documentation) to English for open-source
  contribution.
- Readiness now recovers after transient persistence failures while retaining lifetime loss counters;
  route and video-asset lifecycles settle exactly once and retry failed cleanup.

### Fixed

- Audio transcription multipart now sends a clean, deterministic filename to the upstream provider on
  Bun (it previously leaked the local temporary file path).
- Integration tests now run each file in its own `bun test` process (`scripts/run-integration.ts`) with
  a generous per-test timeout. Under shared-process `bun test` they had silently skipped 15 of 25 (one
  file's teardown closed the shared Postgres/Redis connections for the rest), so CI reported green while
  exercising less than half the suite.

### Removed

- The partitioned `request_logs` subsystem, its jobs/scripts/settings, obsolete router retry columns,
  the `gateway_operations.legacy` marker, query-string API keys, and the `/health` compatibility alias.
- V1 encrypted rows at the keyring baseline. The migration expires pending videos and removes
  deployments, extension artifacts/instances, and retained payload samples; recreate configuration
  after upgrading as documented.

- `db:verify` development script (the integration tests cover the same CRUD/encryption round-trip).
- `gc:response-states` and `db:drain-default` scripts — their work now runs automatically in-app.
