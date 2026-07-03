---
name: In-app browser permission prompts silently fail
description: Camera/GPS permission dialogs don't appear (or auto-deny) when a PWA is opened inside Messenger/Instagram/TikTok/WeChat in-app webviews
---

When a user reports "I never saw a permission prompt" for camera or
geolocation, and the app immediately shows a denied/error state instead,
suspect the page was opened inside a social app's embedded in-app browser
(Facebook/Messenger, Instagram, TikTok, WeChat, LINE, Snapchat, etc.)
rather than the device's real browser (Safari/Chrome).

**Why:** these embedded WebViews often don't implement the OS-level
permission UI at all, or reuse a cached denial, so `getUserMedia`/
`geolocation.getCurrentPosition` reject instantly with a permission-denied
error and the user never sees a prompt to accept. This is a platform
limitation, not a bug in the app's request flow.

**How to apply:** detect known in-app browser user-agent markers (fban/fbav,
messenger, instagram, tiktok/musical_ly, micromessenger, line/, snapchat,
etc.) and show an explicit warning + "open in Safari/Chrome" instructions
(plus a copy-link fallback) before the user hits the permission-requesting
button — don't just retry the permission request, it won't help.
