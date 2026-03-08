# Locales

This directory stores locale files for the Web UI.

## File Layout

- `en/`
- `zh-Hans/`
- `zh-Hant/`
- `common.json` for shared controls and common UI strings
- `errors.json` for user-facing errors
- `web.json` for Web UI screens

See `locales/meta/tiers.json` for completeness requirements.

## Validation

Run these checks before shipping locale or Web UI changes:

- `node ./scripts/check-locales.mjs`
- `node ./scripts/check-forbidden-locale-ids.mjs`
- `node ./scripts/check-i18n-keys.mjs`
