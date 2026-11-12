# Niches public service website

The public service website is served as static assets from `/niches.html`,
`/niches-guide.html` and `/niches-support.html`. It explains existing Niches
features, publishing controls, TikTok limitations, recovery and support. Terms
and Privacy links are visible in the navigation and footer without opening a menu.
The signed-in workspace and authentication surface remain at `/`.

These pages contain no customer media, account data, credentials, trackers or
third-party embeds. They do not change account access, database schemas, schedules,
platform permissions or the hosted ClipMine boundary. They describe the current
sandbox restriction honestly and do not assert TikTok production approval.

The public information site addresses the previous login-only website URL.
It is not a public-launch security certification and does not remove the launch
gates documented in ADR-007. Production eligibility and video completeness still
require final review before submitting to TikTok.

Check static HTML structure and local links, then verify all three public routes,
mobile layout, Terms/Privacy access and the Open workspace link after deployment.
