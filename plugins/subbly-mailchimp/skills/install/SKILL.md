---
name: install
description: Finish setting up the Mailchimp Newsletter plugin after install. Use in the setup chat, or whenever the newsletter modal or its /api/newsletter route is missing from the storefront.
---

# Mailchimp Newsletter setup

Goal: the homepage shows a newsletter modal 10 seconds after load; submitting it subscribes the contact to the Mailchimp audience, applies the configured tag, and adds them to the configured segment.

The install form has already collected the config into the environment:

- `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` (secret)
- `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID`
- `PLUGIN_SUBBLY_MAILCHIMP__TAG`
- `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID` (optional)

If `API_KEY`, `SEGMENT_ID` or `TAG` is empty, stop and ask the user to fill the plugin's config fields in project settings, then continue.

## 1. Verify the connection

The data centre is the suffix of the API key after `-` (e.g. `...-us11` means `us11`). With `execute_command`:

```sh
curl -sS -u "any:$PLUGIN_SUBBLY_MAILCHIMP__API_KEY" \
  "https://<dc>.api.mailchimp.com/3.0/ping"
```

A healthy key returns `{"health_status":"Everything's Chimpy!"}`. A 401 means the key is wrong: ask the user to re-copy it from Mailchimp (Account > Extras > API keys) and stop.

## 2. Resolve the audience

If `AUDIENCE_ID` is set, trust it. Otherwise list the audiences:

```sh
curl -sS -u "any:$PLUGIN_SUBBLY_MAILCHIMP__API_KEY" \
  "https://<dc>.api.mailchimp.com/3.0/lists?fields=lists.id,lists.name"
```

- One audience: the route auto-detects it, nothing to do. Note its id for the checks below.
- Several: ask the user which one, then tell them to put that id in the `AUDIENCE_ID` config field. The route needs it to disambiguate.
- None: the user must create an audience in Mailchimp first.

## 3. Resolve the segment

List the audience's segments:

```sh
curl -sS -u "any:$PLUGIN_SUBBLY_MAILCHIMP__API_KEY" \
  "https://<dc>.api.mailchimp.com/3.0/lists/<audience>/segments?count=1000&fields=segments.id,segments.name,segments.type"
```

Match `SEGMENT_ID` by numeric id, or by name (case-insensitive) against a `type: "static"` segment.

- Match found and static: good.
- Match is `type: "saved"`: a saved segment updates itself by rules and cannot take members added by the route. Tell the user; the tag will still be applied. Suggest they point `SEGMENT_ID` at a static segment (or the tag's name) instead.
- No match: offer to create a static segment with that name:

  ```sh
  curl -sS -u "any:$PLUGIN_SUBBLY_MAILCHIMP__API_KEY" \
    -X POST "https://<dc>.api.mailchimp.com/3.0/lists/<audience>/segments" \
    -d '{"name":"<SEGMENT_ID value>","static_segment":[]}'
  ```

  Only create it after the user agrees.

## 4. The tag

Nothing to configure. Mailchimp creates the tag the first time the route applies it. Just confirm the exact tag name with the user (it is case-sensitive in the Mailchimp UI).

## 5. Wire the modal and route into the storefront

Load the `subbly-mailchimp:newsletter-modal` skill and follow it to create:

- `app/api/newsletter/route.ts` — the server route.
- `components/NewsletterModal.tsx` — the modal.
- The `<NewsletterModal />` mount on the homepage (`app/page.tsx`).
- The fallback CSS, only if the storefront has no design system components to reuse.

Match the storefront's existing styling. Keep the behaviour exactly as the skill specifies: 10-second delay, homepage only, once per visitor via `localStorage`.

## 6. Test end to end

1. In the preview, open the homepage and wait 10 seconds for the modal.
2. Submit with a real address you control (a `you+test@yourdomain` alias is fine). Confirm the form shows "Thanks for subscribing!".
3. Check Mailchimp: the contact is in the audience with the first and last name, has the tag, and is in the segment.
4. Archive the test contact.

If step 2 fails, read the `/api/newsletter` response in the network panel and the server logs. The route returns `"Please enter a valid email address."` for addresses Mailchimp rejects and a generic error for anything else.

## Gotchas

- The API key is a secret. It stays in the environment, is read only by the server route, and is never pasted into the chat, committed, or referenced from client code.
- The browser cannot call Mailchimp directly (no CORS, and the key would leak). Every sign-up goes through `/api/newsletter`.
- A contact who previously unsubscribed will not be silently resubscribed; the route uses `status_if_new` so this is expected, not a bug.
- If the audience enforces confirmed (double) opt-in, sign-ups sit as "pending" until the contact clicks the confirmation email. Set `status_if_new` to `"pending"` in the route to make that explicit.
- Config changes reach a running preview only on the next sync.
