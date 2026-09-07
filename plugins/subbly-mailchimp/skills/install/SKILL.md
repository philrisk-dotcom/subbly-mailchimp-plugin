---
name: install
description: Set up the Mailchimp newsletter modal on the storefront and keep it working. Use in the setup chat; when the modal or its /api/newsletter route is missing; when its copy, delay, styling or which pages it shows on change; when sign-ups stop reaching Mailchimp.
---

# Mailchimp newsletter setup and modal

The homepage shows a modal 10 seconds after load capturing First name, Last name and Email; submitting it subscribes the contact to the Mailchimp audience, applies the tag, and adds them to the segment. The browser cannot reach Mailchimp (no CORS, and the key must not ship to the client), so a server route brokers every sign-up.

## 1. Check config and connection

The config fields arrive as `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` (secret), `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID`, `PLUGIN_SUBBLY_MAILCHIMP__TAG` and the optional `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID`. If any of the first three is empty, ask the user to fill the plugin's config fields in project settings and wait.

The data centre is the API key suffix after `-` (`...-us11` means `us11`). Call `GET https://<dc>.api.mailchimp.com/3.0/ping` with `execute_command`, authenticated as HTTP Basic `any:<API_KEY>`.

Done: the ping returns `health_status: "Everything's Chimpy!"`. On 401, tell the user to re-copy the key from Mailchimp (Account > Extras > API keys) and stop.

## 2. Resolve the audience

If `AUDIENCE_ID` is set, use it. Otherwise call `GET /lists` for `lists.id` and `lists.name`.

- One audience: note its id.
- Several: ask the user which one and tell them to set the `AUDIENCE_ID` field to that id.
- None: tell the user to create an audience in Mailchimp, then stop.

Done: you hold exactly one audience id.

## 3. Resolve the segment

Call `GET /lists/<audience>/segments` for `segments.id`, `segments.name` and `segments.type`. Match `SEGMENT_ID` by numeric id, or by case-insensitive name against a `type: "static"` segment.

- Static match: note its id.
- `type: "saved"` match: tell the user a saved segment cannot take members from the route, so only the tag will apply, and suggest they point `SEGMENT_ID` at a static segment or the tag name.
- No match: offer to create a static segment named after the `SEGMENT_ID` value (`POST /lists/<audience>/segments` with `name` and an empty `static_segment` array), and create it only if the user agrees.

Done: `SEGMENT_ID` maps to a static segment id, or the user has accepted that it is tag-only.

## 4. Confirm the tag

Mailchimp creates the tag on first use. Confirm the exact spelling with the user; the name is case-sensitive in the Mailchimp UI.

Done: the user has confirmed the tag name.

## 5. Build the route and modal

Work in the storefront's own framework and component conventions; adapt the contracts in the Reference section rather than pasting them.

- Create or update `app/api/newsletter/route.ts` (or `pages/api/newsletter.ts` on the Pages Router) to the Route contract.
- Create or update `components/NewsletterModal.tsx` to the Modal contract, reusing the storefront's Dialog, Button and Input components and design tokens where they exist.
- Render the modal from the homepage component `app/page.tsx`, not the root layout. If it must sit in a shared layout, gate it on the current route being `/`.

Done: the three edits are in place and the preview builds with no error.

## 6. Test end to end

Open the homepage in the preview, wait 10 seconds, and submit with a real address you control (a `you+test@yourdomain` alias works). Confirm the modal shows the thank-you message. In Mailchimp, confirm the contact carries the first and last name, the tag and the segment, then archive the test contact. If the submit fails, read the `/api/newsletter` response and the server logs.

Done: a real submission appears in Mailchimp with the name, tag and segment.

## Reference

### Config

| Env var | From field | Meaning |
| --- | --- | --- |
| `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` | API key (secret) | Auth. Read by the server route only. |
| `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID` | Segment ID or name | Digits are an id; text is resolved against the audience's static segments. |
| `PLUGIN_SUBBLY_MAILCHIMP__TAG` | Tag | Applied to every contact. |
| `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID` | Audience ID (optional) | Blank means the route auto-detects the one audience on the account. |

A saved config change reaches a running preview only at the next sync.

### Route contract

`POST` only, reading the four env vars.

- Respond 500 when `API_KEY` is unset.
- Parse `firstName`, `lastName`, `email` from the JSON body; respond 400 on malformed JSON.
- Trim and lowercase the email; respond 400 with `"Please enter a valid email address."` when it fails a basic shape check.
- Resolve the audience and the segment once each (env var, or the lookups from steps 2 and 3) and cache both for the process lifetime.
- Upsert the member per the Mailchimp API notes. Respond 502 on a failure that is not `"Member Exists"`, except a `"looks fake"` detail, which returns 400 with the validation message above.
- Apply the tag, then add to the resolved segment. Both are non-fatal on failure.
- Respond `{ ok: true }` on success.

### Modal contract

- Client component. On mount it reads the `localStorage` key `subbly-mailchimp-newsletter:seen`; if present it stays closed, otherwise it opens after a 10-second timer. It renders nothing while closed.
- Open state is a dialog with `role="dialog"`, `aria-modal="true"` and a labelled heading, closable by overlay click, a close button and Escape.
- Closing by any means, and a successful submit, write the `localStorage` key so the modal stays closed for that visitor.
- The form has First name, Last name and Email inputs with `autoComplete` `given-name`, `family-name` and `email`, all required, and a submit button that disables and shows a busy label during the request.
- Submit sends JSON `{ firstName, lastName, email }` to `/api/newsletter`. A failed response keeps the modal open and shows the response `error` text, or a generic message. A success replaces the form with a short thank-you message.

### Mailchimp API notes

- Base URL `https://<dc>.api.mailchimp.com/3.0`; auth header `Authorization: Basic base64("any:" + API_KEY)`.
- Subscriber hash: the lowercased email, MD5-hashed. Member and tag endpoints key off it.
- Upsert: `PUT /lists/{audience}/members/{hash}` with `status_if_new: "subscribed"` and `merge_fields: { FNAME, LNAME }`. `status_if_new` rather than `status` leaves an earlier unsubscribe untouched instead of erroring.
- Tag: `POST /lists/{audience}/members/{hash}/tags` with `tags: [{ name: TAG, status: "active" }]`.
- Segment: `POST /lists/{audience}/segments/{segmentId}/members` with `email_address`.

### Changing the modal later

- **Delay**: the 10-second timer constant.
- **Frequency**: the `localStorage` key suppresses the modal for good once set. To re-show after N days, store a timestamp and compare it on load.
- **Pages**: mount the component on other pages too; each page load runs its own timer.
- **Double opt-in**: for an audience that requires confirmed opt-in, set the route's `status_if_new` to `"pending"`; Mailchimp then emails a confirmation link and leaves the contact uncounted until they click it.

### Security

The API key is a secret: it stays in the server environment and never appears in client code, the chat, or a commit.
