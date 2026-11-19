# YouTube Terms of Service review for yt-music-redirect

This is documentation, not legal advice. Text was copied from the YouTube Terms
of Service and reviewed on 2026-11-19 (`T1bc040fe`).

## Source

- YouTube Terms of Service: `https://www.youtube.com/t/terms`
  ("Permissions and Restrictions", read 2026-11-19)

## Relevant clauses

Under **Permissions and Restrictions**, the YouTube Terms of Service state:

> You may access and use the Service as made available to you, as long as you
> comply with this Agreement and applicable law. You may view or listen to
> Content for your personal, non-commercial use.
>
> The following restrictions apply to your use of the Service. You are not
> allowed to:
>
> 1. access, reproduce, download, distribute, transmit, broadcast, display,
>    sell, license, alter, modify or otherwise use any part of the Service or
>    any Content except: (a) as expressly authorized by the Service; or (b)
>    with prior written permission from YouTube and, if applicable, the
>    respective rights holders;
> 2. circumvent, disable, fraudulently engage with, or otherwise interfere with
>    any part of the Service (or attempt to do any of these things), including
>    security-related features or features that (a) prevent or restrict the
>    copying or other use of Content or (b) limit the use of the Service or
>    Content;
> 3. access the Service using any automated means (such as robots, botnets or
>    scrapers) except (a) in the case of public search engines, in accordance
>    with YouTube's robots.txt file; or (b) with YouTube's prior written
>    permission;

## Current script behaviour & items flagged for owner review

`yt-music-redirect` runs on `https://www.youtube.com/*` and redirects detected
music videos from `www.youtube.com/watch?v=<id>` to
`https://music.youtube.com/watch?v=<id>`.

| Behaviour in `yt-music-redirect.user.js` | Terms assessment & owner review flag |
| --- | --- |
| In-page metadata inspection (`ytInitialPlayerResponse` and rendered DOM metadata on `www.youtube.com/watch`) | Reads data already delivered to the browser tab during the user's own navigation without extra network requests. |
| **FLAGGED FOR OWNER REVIEW:** Background HTML fetch in `fetchChannelStatus(videoId)` (`fetch('https://www.youtube.com/watch?v=' + videoId, { credentials: 'same-origin' })`) | When SPA navigation causes `ytInitialPlayerResponse` to lag or appear stale, `fetchChannelStatus()` issues a background HTTP `fetch` for the watch page HTML and regex-scrapes `category`, `ownerChannelName`, and `attributedDescriptionBodyText`. This background fetch-and-parse pattern risks conflicting with Clause 3 ("access the Service using any automated means (such as robots, botnets or scrapers)"). **Recommendation for owner decision:** remove the background `fetch()` fallback and instead read the live player response from `#movie_player.getPlayerResponse()` / `yt-page-data-updated` event detail (the pattern used in `ytm-data-panel`). |
| **FLAGGED FOR OWNER REVIEW:** Unprompted automatic navigation via `window.location.replace('https://music.youtube.com/watch?v=' + videoId)` | When a watch page matches music detection or a user-allowlisted channel, `performRedirect()` immediately redirects the tab to YouTube Music without a per-video click. While triggered by the user opening a video with the userscript installed, owner review should confirm whether automatic unprompted redirection across YouTube properties is acceptable or whether an explicit click-to-open pill (like `ytm-desktop-handoff`) should be preferred. |
