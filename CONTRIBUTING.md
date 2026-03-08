# Contributing

Thank you for contributing to `ironclaw-zh`.

`ironclaw-zh` is a community-maintained, Chinese-localized distribution based on [nearai/ironclaw](https://github.com/nearai/ironclaw). This repository focuses on localization, documentation, user experience, and release quality.

## Project Principles

- Stay practically compatible with upstream IronClaw.
- Prefer localization and distribution-layer improvements over runtime rewrites.
- Preserve upstream security assumptions and core behavior.
- Keep changes small, reviewable, and easy to rebase.

## What We Welcome

- Chinese documentation
- Chinese Web UI copy and i18n groundwork
- Chinese skills
- Deployment and configuration guides
- Locale governance and terminology consistency
- Model and deployment presets

## High-Risk Areas

The following areas need extra review:

- core agent runtime behavior
- sandbox execution behavior
- tool runtime or capability model changes
- skills trust model changes
- credential handling
- network exposure defaults

## Out of Scope for Early Contributions

- rewriting IronClaw core runtime
- replacing upstream security architecture
- translating env var names, CLI subcommands, WIT interfaces, or capability field names

## Feature Parity Requirement

When your change affects a tracked capability, update `FEATURE_PARITY.md` in the same branch.

Required before opening a PR:

1. Review the relevant parity rows in `FEATURE_PARITY.md`.
2. Update status or notes if behavior changed.
3. Include the `FEATURE_PARITY.md` diff in your branch when applicable.

## Writing and UI Checks

All user-facing writing should follow:

- `docs/zh-Hans/terminology.md`
- `docs/zh-Hans/style-guide.md`

If you change wording, terminology, or UI strings, keep them consistent with those files and the existing locale files.

Required checks for locale or Web UI changes:

- `node ./scripts/check-locales.mjs`
- `node ./scripts/check-forbidden-locale-ids.mjs`
- `node ./scripts/check-i18n-keys.mjs`
- `node --check ./src/channels/web/static/app.js`
- `node --check ./src/channels/web/static/i18n.js`

## Pull Request Scope

Recommended PR types:

- docs only
- i18n only
- UI text only
- skills only
- presets only
- one isolated runtime fix

Avoid combining multiple unrelated categories into one PR.

## Branch Naming

Use descriptive branch names with the `codex/` prefix for Codex-created work and clear topical prefixes for team branches, for example:

- `codex/zh-bootstrap`
- `feature/docs-overview`
- `feature/i18n-auth-nav`
- `fix/locale-validation`

## License and Attribution

This repository follows the upstream licensing model. Do not remove upstream license files or attribution.

## Versioning Policy

- Follow the upstream IronClaw base version.
- Keep the package version aligned to upstream.
- Use an `-zh.N` suffix only for `ironclaw-zh` Git tags and GitHub releases.
- Keep release tags and release notes aligned with the chosen upstream base.
