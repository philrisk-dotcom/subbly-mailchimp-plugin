# subbly-mailchimp-plugin

Subbly marketplace repo for the **Mailchimp** plugin.

It captures newsletter sign-ups on the storefront with a timed modal (First name, Last
name, Email) and sends them to Mailchimp: subscribes the contact to the audience,
applies a tag, and adds them to a segment. The API key, segment and tag are collected
on the install form; **Finish setup** verifies the connection and wires the modal into
the storefront.

## Layout

- `marketplace.json` — lists the plugin by slug. The `version` bump is the only release trigger.
- `plugins/subbly-mailchimp/plugin.json` — manifest: display name, config fields, `setup: true`.
- `plugins/subbly-mailchimp/skills/install/SKILL.md` — the setup-chat procedure and the build reference (the `/api/newsletter` route and the modal component), in one skill.

## Develop

```bash
npm install
npm run lint
```

`npm run lint` is the release gate. Zero errors means the marketplace passes.
`npx subbly-plugin-lint --strict` runs the same rules and fails on warnings too.

## Release

Bump `version` in `marketplace.json` and merge to `main`.

## Config fields

| Field | Env var | Notes |
| --- | --- | --- |
| Mailchimp API key | `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` | Secret. The suffix after `-` is the data centre. |
| Segment ID or name | `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID` | Numeric id, or a static segment name to resolve. |
| Tag | `PLUGIN_SUBBLY_MAILCHIMP__TAG` | Applied to every contact; created on first use. |
| Audience ID (optional) | `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID` | Blank auto-detects the one audience on the account. |
