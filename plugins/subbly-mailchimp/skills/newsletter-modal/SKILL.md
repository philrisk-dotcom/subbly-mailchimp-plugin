---
name: newsletter-modal
description: Build or change the Mailchimp newsletter sign-up modal and its server route on the storefront. Use when the modal or the /api/newsletter route is missing, when the user wants to restyle the modal, change its copy, change the 10-second delay or which pages it shows on, or when sign-ups are not reaching Mailchimp.
---

# Mailchimp newsletter modal

The plugin captures First name, Last name and Email in a modal that appears **10 seconds after the homepage loads**, once per visitor, and posts them to a server route that talks to Mailchimp. The browser never calls Mailchimp directly: the API key is a secret and Mailchimp sends no CORS headers.

## Config

Set from the install form, read by the server route only:

| Env var | From field | Use |
| --- | --- | --- |
| `PLUGIN_SUBBLY_MAILCHIMP__API_KEY` | API key (secret) | Auth. The part after `-` is the data centre (`...-us11` -> `us11`). |
| `PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID` | Segment ID or name | Static segment to add the contact to. Digits are used as-is; a name is resolved against the audience's segments. |
| `PLUGIN_SUBBLY_MAILCHIMP__TAG` | Tag | Tag applied to every contact. Created by Mailchimp on first use. |
| `PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID` | Audience ID (optional) | The list. Blank means "auto-detect the one audience on the account". |

Never read these in client code and never inline them into a component.

## Mailchimp Marketing API notes

- Base URL: `https://<dc>.api.mailchimp.com/3.0`.
- Auth header: `Authorization: Basic base64("any:" + API_KEY)`.
- Subscriber hash: lowercase the email, then MD5. All member and tag endpoints key off this hash.
- Upsert a member: `PUT /lists/{audience}/members/{hash}` with `status_if_new: "subscribed"` and `merge_fields: { FNAME, LNAME }`. Using `status_if_new` (not `status`) avoids the "cannot resubscribe" error on a contact who unsubscribed earlier.
- An existing contact comes back as HTTP 400 `title: "Member Exists"`. Treat that as success.
- A junk address comes back as HTTP 400 with `detail` containing `looks fake`. Surface that as a validation message, not a server error.
- Apply the tag with `POST /lists/{audience}/members/{hash}/tags`, body `{ "tags": [{ "name": TAG, "status": "active" }] }`. Works for new and existing contacts.
- Add to a static segment: `POST /lists/{audience}/segments/{segmentId}/members`, body `{ "email_address": email }`. Saved (auto-updating) segments reject this; keep the call non-fatal.

## Server route

`app/api/newsletter/route.ts` (Next.js App Router; if the storefront still uses `pages/`, port it to `pages/api/newsletter.ts` with the same logic):

```ts
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'

const API_KEY = process.env.PLUGIN_SUBBLY_MAILCHIMP__API_KEY
const TAG = process.env.PLUGIN_SUBBLY_MAILCHIMP__TAG
const SEGMENT = process.env.PLUGIN_SUBBLY_MAILCHIMP__SEGMENT_ID
const AUDIENCE = process.env.PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID
const DC = API_KEY?.split('-')[1]
const BASE = `https://${DC}.api.mailchimp.com/3.0`

function mc(path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`any:${API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
}

let cachedAudience: string | null = AUDIENCE || null
async function resolveAudience(): Promise<string> {
  if (cachedAudience) return cachedAudience
  const res = await mc('/lists?count=2&fields=lists.id')
  const data = await res.json()
  if (!res.ok || !data.lists?.length) throw new Error('no audience')
  if (data.lists.length > 1) throw new Error('multiple audiences: set PLUGIN_SUBBLY_MAILCHIMP__AUDIENCE_ID')
  cachedAudience = data.lists[0].id as string
  return cachedAudience
}

let cachedSegment: number | null | undefined
async function resolveSegment(audience: string): Promise<number | null> {
  if (cachedSegment !== undefined) return cachedSegment
  if (!SEGMENT) return (cachedSegment = null)
  if (/^\d+$/.test(SEGMENT)) return (cachedSegment = Number(SEGMENT))
  const res = await mc(`/lists/${audience}/segments?count=1000&fields=segments.id,segments.name,segments.type`)
  const data = await res.json()
  const match = data.segments?.find(
    (s: { id: number; name: string; type: string }) =>
      s.type === 'static' && s.name.toLowerCase() === SEGMENT.toLowerCase(),
  )
  return (cachedSegment = match ? match.id : null)
}

export async function POST(req: NextRequest) {
  if (!API_KEY || !DC) {
    return NextResponse.json({ error: 'Newsletter sign-up is not configured.' }, { status: 500 })
  }

  let body: { firstName?: string; lastName?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const FNAME = body.firstName?.trim() ?? ''
  const LNAME = body.lastName?.trim() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  try {
    const audience = await resolveAudience()
    const hash = crypto.createHash('md5').update(email).digest('hex')

    const upsert = await mc(`/lists/${audience}/members/${hash}`, {
      method: 'PUT',
      body: JSON.stringify({ email_address: email, status_if_new: 'subscribed', merge_fields: { FNAME, LNAME } }),
    })
    const upsertData = await upsert.json()
    if (!upsert.ok && upsertData.title !== 'Member Exists') {
      const fake = typeof upsertData.detail === 'string' && upsertData.detail.includes('looks fake')
      return NextResponse.json(
        { error: fake ? 'Please enter a valid email address.' : 'Could not sign you up right now.' },
        { status: fake ? 400 : 502 },
      )
    }

    if (TAG) {
      await mc(`/lists/${audience}/members/${hash}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: [{ name: TAG, status: 'active' }] }),
      }).catch(() => {})
    }

    const segmentId = await resolveSegment(audience)
    if (segmentId) {
      await mc(`/lists/${audience}/segments/${segmentId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email_address: email }),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not sign you up right now.' }, { status: 502 })
  }
}
```

## Modal component

`components/NewsletterModal.tsx`. Behaviour is the contract; the markup and styling should match the storefront's design system (reuse its Dialog/Button/Input components and tokens if it has them, otherwise the plain markup below with the CSS at the end).

```tsx
'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'subbly-mailchimp-newsletter:seen'
const DELAY_MS = 10_000

export default function NewsletterModal() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch {}
    const t = setTimeout(() => setOpen(true), DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  function remember() {
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString())
    } catch {}
  }

  function close() {
    setOpen(false)
    remember()
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setState('loading')
    setMessage('')
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: data.get('firstName'),
          lastName: data.get('lastName'),
          email: data.get('email'),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setState('error')
        setMessage(json.error ?? 'Something went wrong. Please try again.')
        return
      }
      setState('done')
      setMessage('Thanks for subscribing!')
      remember()
    } catch {
      setState('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  if (!open) return null

  return (
    <div
      className="newsletter-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="newsletter-modal-title"
      onClick={close}
    >
      <div className="newsletter-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="newsletter-modal-close" aria-label="Close" onClick={close}>
          &times;
        </button>
        {state === 'done' ? (
          <p>{message}</p>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 id="newsletter-modal-title">Join our newsletter</h2>
            <p>Be the first to hear about new drops and offers.</p>
            <input name="firstName" placeholder="First name" autoComplete="given-name" required />
            <input name="lastName" placeholder="Last name" autoComplete="family-name" required />
            <input name="email" type="email" placeholder="Email address" autoComplete="email" required />
            <button type="submit" disabled={state === 'loading'}>
              {state === 'loading' ? 'Signing you up…' : 'Subscribe'}
            </button>
            {state === 'error' && (
              <p className="newsletter-modal-error" role="alert">
                {message}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
```

Fallback CSS, if the storefront has no design system to borrow from (add to the global stylesheet):

```css
.newsletter-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}
.newsletter-modal {
  position: relative;
  background: #fff;
  color: #111;
  border-radius: 12px;
  padding: 2rem;
  max-width: 24rem;
  width: 100%;
}
.newsletter-modal h2 {
  margin: 0 0 0.5rem;
}
.newsletter-modal form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.newsletter-modal input,
.newsletter-modal button {
  padding: 0.6rem 0.75rem;
  font: inherit;
  border-radius: 8px;
  border: 1px solid #ccc;
}
.newsletter-modal button[type='submit'] {
  background: #111;
  color: #fff;
  border: none;
  cursor: pointer;
}
.newsletter-modal-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}
.newsletter-modal-error {
  color: #b00020;
  margin: 0;
}
```

## Mounting it on the homepage only

Render `<NewsletterModal />` from the homepage component (`app/page.tsx`), not the root layout. That keeps the 10-second timer scoped to the homepage:

```tsx
import NewsletterModal from '@/components/NewsletterModal'

// ...inside the page's returned JSX, near the end:
<NewsletterModal />
```

If it must live in the layout for structural reasons, gate it with `usePathname() === '/'` inside the component instead.

## Adjustments

- **Delay**: change `DELAY_MS`.
- **Frequency**: the `localStorage` key suppresses the modal after it is seen or submitted once. To re-show after N days, store the timestamp (already stored) and compare on load.
- **More pages**: mount the component on those pages too; each page load runs its own timer.
- **Double opt-in**: if the audience requires confirmed opt-in, switch `status_if_new` to `"pending"`; Mailchimp then emails a confirmation link and the contact is not counted until they click it.

## Testing

1. `PLUGIN_SUBBLY_MAILCHIMP__*` must be set in the environment.
2. Load the homepage in the preview, wait 10 seconds, submit with a real address you control.
3. The form should show "Thanks for subscribing!".
4. In Mailchimp, confirm the contact is in the audience with the first/last name, carries the tag, and appears in the segment.
5. Archive the test contact afterwards.

If the form errors, check the route's response in the network tab and the server logs; the route returns a specific `error` string for bad addresses and a generic one for Mailchimp failures.
