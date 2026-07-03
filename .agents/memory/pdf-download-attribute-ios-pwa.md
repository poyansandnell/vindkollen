---
name: PDF/file `download` attribute unreliable on iOS Safari and installed PWAs
description: Why an <a download> link that works on desktop can silently fail to do anything on mobile, especially inside an installed PWA.
---

An `<a href="file.pdf" download>` link that works fine on desktop Chrome/
Firefox can silently do nothing (or just navigate without saving) on iOS
Safari, and this gets worse when the site is installed as a standalone PWA.

**Why:** iOS Safari has historically ignored or only partially honored the
`download` attribute for many file types, and standalone-mode PWAs have no
"Downloads" manager UI for a saved file to land in — there's nowhere for the
browser to put it, so the attribute effectively no-ops. Desktop testing alone
won't catch this because desktop browsers implement `download` correctly.

**How to apply:** For user-facing "view/download this PDF" links in a PWA,
drop the `download` attribute and just use `target="_blank" rel="noopener
noreferrer"`. This opens the file in the browser's native PDF viewer /
in-app browser tab on every platform, where the user can use the OS's own
share/save sheet — which is consistently available, unlike a bare `download`
attribute.
