# ExcaVision

Completed academic IoT tilt-monitoring prototype, retained for public archival and possible continuation.

- Preserve the manuscript WBS: 2 Manage Requests (public/customer submission), 3 Set Up Sites (admin review/approval/setup/invitations), 4 Process Readings, 5 Generate Events, 6 Monitor Sites. Modules cross frontend/backend boundaries; shared files can serve several modules.
- Each application, backend tooling, and firmware uses explicit production/staging configuration. Commit placeholder examples only; never commit real environment files, device credentials, deployment state, or customer data.
- Firmware changes are not on hardware until physically flashed and tested. Full reset hold is 10 seconds; Gateway role hold is 3 seconds.
- Keep security limitations and restart requirements in docs/HANDOVER.md current. This is a prototype, not a certified safety system.
- Nuxt builds/typechecks must run on the stronger mlaptop host, not the local ThinkPad. Lightweight syntax/config checks are appropriate locally.
