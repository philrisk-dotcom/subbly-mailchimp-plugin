---
name: install
description: Set up and maintain the Mailchimp newsletter modal on the storefront. Use in the setup chat, and again whenever the modal or the /api/newsletter route is missing, its copy, styling, delay or pages need to change, or sign-ups are not reaching Mailchimp.
---

# Mailchimp newsletter setup and modal

Goal: the homepage shows a modal 10 seconds after load, capturing First name, Last name and Email; submitting it subscribes the contact to the Mailchimp audience, applies the configured tag, and adds them to the configured segment. The browser never calls Mailchimp directly: the API key is a secret and Mailchimp sends no CORS headers, so every sign-up must go through a server route.

## Config

Collected by the install form, read by the server route only:

| Env var | From field | Use |
| --- | --- | --- |
| `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` | API key (secret) | Auth. The part after `-` is the data centre (`...-us11` -> `us11`). |
| `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID` | Segment ID or name | Static segment to add the contact to. Digits are used as-is; a name is resolved against the audience's segments. |
| `PLUGIN_SUBBLY_MAILCHIMP__TAG` | Tag | Tag applied to every contact. Created by Mailchimp on first use. |
| `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID` | Audience ID (optional) | The list. Blank means "auto-detect the one audience on the account". |

Never read these in client code and never inline them into a component. If `API_KEY`, `SEGMENT_ID` or `TAG` is empty, stop and ask the user to fill the plugin's config fields in project settings, then continue.

## 1. Verify the connection

The data centre is the suffix of the API key after `-`. Call `GET https://<dc>.api.mailchimp.com/3.0/ping` with `execute_command`, authenticated as HTTP Basic `any:<API_KEY>`.

A healthy key returns `health_status: "Everything's Chimpy!"`. A 401 means the key is wrong: ask the user to re-copy it from Mailchimp (Account > Extras > API keys) and stop.

## 2. Resolve the audience

If `AUDIENCE_ID` is set, trust it. Otherwise call `GET /lists` on the same base URL, asking for `lists.id` and `lists.name`.

- One audience: the route auto-detects it, nothing to do. Note its id for the checks below.
- Several: ask the user which one, then tell them to put that id in the `AUDIENCE_ID` config field. The route needs it to disambiguate.
- None: the user must create an audience in Mailchimp first.

## 3. Resolve the segment

Call `GET /lists/<audience>/segments` asking for `segments.id`, `segments.name` and `segments.type`. Match `SEGMENT_ID` by numeric id, or by name (case-insensitive) against a `type: "static"` segment.

- Match found and static: good.
- Match is `type: "saved"`: a saved segment updates itself by rules and cannot take members added by the route. Tell the user; the tag will still be applied. Suggest they point `SEGMENT_ID` at a static segment (or the tag's name) instead.
- No match: offer to create one — `POST /lists/<audience>/segments` with `name` set to the `SEGMENT_ID` value and an empty `static_segment` array — only after the user agrees.

## 4. The tag

Nothing to configure. Mailchimp creates the tag the first time the route applies it. Just confirm the exact tag name with the user (it is case-sensitive in the Mailchimp UI).

## Mailchimp Marketing API reference

- Base URL: `https://<dc>.api.mailchimp.com/3.0`.
- Auth header: `Authorization: Basic base64("any:" + API_KEY)`.
- Subscriber hash: lowercase the email, then MD5. All member and tag endpoints key off this hash.
- Upsert a member: `PUT /lists/{audience}/members/{hash}` with `status_if_new: "subscribed"` and `merge_fields: { FNAME, LNAME }`. Using `status_if_new` (not `status`) avoids the "cannot resubscribe" error on a contact who unsubscribed earlier.
- An existing contact comes back as HTTP 400 with `title: "Member Exists"`. Treat that as success.
- A junk address comes back as HTTP 400 with `detail` containing "looks fake". Surface that as a validation message, not a server error.
- Apply the tag: `POST /lists/{audience}/members/{hash}/tags` with `tags: [{ name: TAG, status: "active" }]`. Works for new and existing contacts.
- Add to a static segment: `POST /lists/{audience}/segments/{segmentId}/members` with `email_address`. Saved (auto-updating) segments reject this; keep the call non-fatal.

## 5. Wire the modal and route into the storefront

Create these if missing, or edit them in place when only styling, copy or behaviour needs to change. Implement to the contract below in whatever style fits the storefront's own conventions (framework, TypeScript strictness, component library); nothing here is a snippet to paste verbatim.

### Server route — `app/api/newsletter/route.ts`

(Next.js App Router; if the storefront still uses `pages/`, use `pages/api/newsletter.ts` with the same contract.)

Handles `POST` only, reading the four env vars above. Contract:

- Reject with 500 if `API_KEY` is unset.
- Parse the JSON body for `firstName`, `lastName`, `email`. Reject malformed JSON with 400.
- Trim and lowercase the email; reject with 400 and `"Please enter a valid email address."` if it fails a basic email shape check.
- Resolve the audience once (env var, or the single audience found via `GET /lists`; cache it for the life of the server process). Resolve the segment once the same way, following the matching rule in step 3, and cache it too.
- Upsert the member per the API reference above. A non-"Member Exists" failure returns 502, except a "looks fake" detail, which returns 400 with the same validation message as above.
- Apply the tag; non-fatal on failure.
- Add to the resolved segment, if any; non-fatal on failure.
- Respond `{ ok: true }` on success.

### Modal component — `components/NewsletterModal.tsx`

Behaviour is the contract; markup and styling should match the storefront's design system (its own Dialog/Button/Input components and tokens) rather than introducing new ones where equivalents already exist.

- Client component. On mount, checks a `localStorage` key (e.g. `subbly-mailchimp-newsletter:seen`) — if already set, never opens. Otherwise starts a 10-second timer before opening.
- Renders nothing while closed.
- While open: a dismissible dialog (overlay click, close button, and ideally Escape) with `role="dialog"`, `aria-modal="true"`, and a labelled heading.
- Closing it (by any means) or a successful submit writes the `localStorage` key so it never reopens for that visitor.
- The form: First name, Last name, Email inputs, all required, sensible `autoComplete` values, a submit button that disables and shows a busy label while the request is in flight.
- On submit: POST JSON `{ firstName, lastName, email }` to `/api/newsletter`. On failure, show the response's `error` message (falling back to a generic one) without closing the modal. On success, replace the form with a short thank-you message.

### Mount it on the homepage only

Render the modal from the homepage component (`app/page.tsx`), not the root layout, so the 10-second timer is scoped to the homepage. If it has to live in a shared layout for structural reasons, gate it on the current route being `/` instead.

### Adjustments

- **Delay**: the 10-second constant.
- **Frequency**: the `localStorage` key currently suppresses the modal permanently once seen or submitted. To re-show after N days, store the timestamp (already implied) and compare it on load instead of a boolean presence check.
- **More pages**: mount the component on those pages too; each page load runs its own timer.
- **Double opt-in**: if the audience requires confirmed opt-in, switch the route's `status_if_new` to `"pending"`; Mailchimp then emails a confirmation link and the contact is not counted until they click it.

## 6. Test end to end

1. In the preview, open the homepage and wait 10 seconds for the modal.
2. Submit with a real address you control (a `you+test@yourdomain` alias is fine). Confirm the form shows the thank-you message.
3. Check Mailchimp: the contact is in the audience with the first and last name, has the tag, and is in the segment.
4. Archive the test contact.

If step 2 fails, read the `/api/newsletter` response in the network panel and the server logs. The route should return a specific message for addresses Mailchimp rejects and a generic one for anything else.

## Gotchas

- The API key is a secret. It stays in the environment, is read only by the server route, and is never pasted into the chat, committed, or referenced from client code.
- The browser cannot call Mailchimp directly (no CORS, and the key would leak). Every sign-up goes through `/api/newsletter`.
- A contact who previously unsubscribed will not be silently resubscribed; using `status_if_new` is expected, not a bug.
- If the audience enforces confirmed (double) opt-in, sign-ups sit as "pending" until the contact clicks the confirmation email.
- Config changes reach a running preview only on the next sync.
