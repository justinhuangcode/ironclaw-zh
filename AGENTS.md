# Agent Rules

## Repository Direction

- Prefer docs, i18n, presets, packaging, and user-experience changes over runtime divergence.
- Keep compatibility with upstream `nearai/ironclaw` wherever practical.

## Validation

- Before closing locale or Web UI work, run `check-locales`, `check-forbidden-locale-ids`, `check-i18n-keys`, and JS syntax checks for `app.js` and `i18n.js`.

## Version Rules

- Keep the upstream IronClaw base version visible in release numbering.
- Use an `-zh.N` suffix for this distribution's Git tags and GitHub releases.

## Feature Parity Update Policy

- If you change implementation status for any feature tracked in `FEATURE_PARITY.md`, update that file in the same branch.
- Do not open a PR that changes feature behavior without checking `FEATURE_PARITY.md` for needed status updates (`❌`, `🚧`, `✅`, notes, and priorities).
