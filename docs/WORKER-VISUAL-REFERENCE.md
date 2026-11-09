# Worker desktop reference lock

The five user screenshots are the build target. The full desktop images define the spacious light frame, rounded blurred landscape, centered app dock and quiet chat column. The two bottom-edge crops define the wide concave composer shoulders and recessed white input. The running screenshot defines the compact pink pause control.

Keep EverFern branding, app installation behavior and real model settings. Use the bundled alpine lake wallpaper with the reference's muted blue, gray and forest tint. Adapt the geometry and visual hierarchy; do not reproduce the reference's sample conversation or internal reasoning text. Model settings remain functional rather than adding a decorative upgrade link.

Wallpaper source: https://images.unsplash.com/photo-1501785888041-af3ef285b470 (bundled as public/images/worker-landscape.jpg so the desktop does not depend on a remote image request).

Worker avatar variants use stable worker IDs to select bundled Unsplash images across the worker list, navigation and deletion dialog. Additional sources: [Gabriele Merlino, misty lake](https://unsplash.com/photos/BEvcOfki46M), [Pat Whelen, dunes](https://unsplash.com/photos/pSWTlXWw6AA).

Follow-up detail lock: keep both the title ribbon and Cloud navigation solid in connection states while the content body stays glass. Dock shoulders overlap the main island by 1px without SVG masks to avoid the reported hairline. Conversation previews show only the latest nonempty assistant reply, normalize Markdown to one readable line, and have no placeholder. Intelligence pill: 38px high, 15px regular type, 16px dotted SVG ring, 28px blue action capsule. Teach: 42px gradient button, 17px regular type, custom 23px pointer-and-rays icon.

Typography correction: use bundled variable Satoshi (300–900, including italics) for worker descriptions, labels and controls; remove the SF Pro reference overrides. Fontshare's network CSS previously supplied Satoshi only after a remote load. Local font and FFL license: public/fonts/satoshi. Source: https://www.fontshare.com/fonts/satoshi.

Motion correction: sidebar hover uses 220–280ms transitions for transform, color, opacity and shadows. Thumbnail return animations no longer inherit an index-dependent delay. Sidebar entry/exit and frame resizing ease together; MotionConfig honors user reduced-motion preferences, with matching CSS handling.

Chrome uses the unmodified full-color SVG from Google's Chrome site: https://www.google.com/chrome/static/images/chrome-logo-m100.svg. Replaces the earlier hand-drawn approximation.

Spacing regression: the unlayered global reset and heading defaults overrode Tailwind's layered p-*, m-* and text-* utilities in the new completion and marketplace product views. Move those defaults into @layer base so the existing component spacing and white text apply. Render the completion summary through the existing safe Markdown formatter.

Logo follow-up: Chrome uses chrome-google.svg as a fresh asset URL, avoiding old copies of the hand-drawn icon. Amazon is now named Amazon and opens amazon.com; its bundled wordmark comes from https://commons.wikimedia.org/wiki/File:Amazon_2024.svg. Moss uses the official application icon at https://www.getmoss.com/favicon/icon.svg. Both render from local files without a logo CDN dependency.

Thumbnail correction: remove the decorative browser traffic lights and fake address bar. Never embed vm.url into each thumbnail: it is a shared desktop and shows the same foreground app under every label. Remove hidden host-machine webviews and synthetic app-page mockups.

Real previews: poll app-scoped cloud captures every 12 seconds while the thumbnail is mounted and the app is visible, using worker/app IDs for every request. Browserbase uses Page.captureScreenshot; VPS apps including Terminal and Files use ef.desktopScreenshot inside their own isolated app container. Restore the app profile, preserve existing navigation, and initialize only a new blank app. Limit captures to two simultaneous requests and deduplicate by VM/worker/app. Alpine browser previews run through vmExec inside the VM against its 19222 DevTools port and create new tabs in the background. Retain the last captured frame during retries; the initial identity card is a temporary loading state, not a substitute for real captures.

Compact follow-up: use a uniform 90% desktop UI scale at the document root, preserving full viewport coverage and keeping small screens at 100%. This scales all app pages and portal dialogs consistently. Settings hides the dock, composer, intelligence pill and boot indicator. Both app-delete badges use centered SVG crosses. The boot pill retains a static circular logo badge, uses a translucent blurred surface, and shimmers only along its perimeter; the separate white orbiting ring is removed.

The latest six supplied screenshots refine this lock: at 1830px, use a 160px collapsed rail or 429px expanded sidebar, 56px right frame, 64px top frame (56px expanded), 38px screen corners, 70px dock depth, 50px app icons with 12px gaps, 510px idle composer and 220px running composer. Composer shoulders combine a 44px cap with a 40px concave flare. Compact layouts reduce margins and keep controls reachable.

The marketplace is 768px wide with a 110px header, 306×50px search, 40px body padding, 114px custom-app card, 38px section corners, 90px app rows and 50px download buttons. The collapsed conversation is a 416×48px glass pill with two quiet stacked rims above the intelligence chip. Files and browser use local vector tiles; Chrome remains a full-color circle and LinkedIn a blue square.

Expanded navigation uses the real worker list and persisted folders. Do not invent a subscription limit card without actual account-limit data. Upgrade opens subscription settings; notifications opens notification settings.
