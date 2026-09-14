# ExcaVision Specs

Keep decisions in one place. Do not duplicate details across files.

## Product definition

The October MVP is the final releasable product for this project, not a
throwaway prototype. MVP means the smallest complete product that can operate
without depending on a later phase. Ideas are being tested through execution,
so every included capability must be reliable enough for the final handoff.

| File | Owns |
|---|---|
| [BRAND_GUIDELINES.md](./BRAND_GUIDELINES.md) | Non-negotiable ExcaVision colors, wordmark, imagery, and shape rules |
| [PHYSICAL_BUILD_SPEC.md](./PHYSICAL_BUILD_SPEC.md) | PCB connections, external wiring, power, placement |
| [NODE_SPEC.md](./NODE_SPEC.md) | Firmware behavior and RS-485 protocol |
| [BACKEND_SPEC.md](./BACKEND_SPEC.md) | Supabase schema, RPCs, RLS, retention |
| [MOBILE_APP_SPEC.md](./MOBILE_APP_SPEC.md) | Customer and installer mobile-app contract |
| [ADMIN_DASHBOARD_SPEC.md](./ADMIN_DASHBOARD_SPEC.md) | ExcaVision staff dashboard, inventory, manifests, and transfers |
| [SERVICE_REQUEST_SPEC.md](./SERVICE_REQUEST_SPEC.md) | Customer coverage requests, service conversation, and estimates |
| [ML_SPEC.md](./ML_SPEC.md) | XGBoost early-warning scope |
| [EXTERNAL_WIRING.png](./EXTERNAL_WIRING.png) | The only wiring diagram |
| [EXCAVISION_ADMIN_DASHBOARD_PROMPT.md](./EXCAVISION_ADMIN_DASHBOARD_PROMPT.md) | One-shot admin dashboard UI-generator prompt |
| [EXCAVISION_MOBILE_APP_PROMPT.md](./EXCAVISION_MOBILE_APP_PROMPT.md) | One-shot mobile app UI-generator prompt |
| `excavision_pcb_design.zip` | KiCad PCB source supplied for fabrication |

## Sources of truth

When documents disagree, use this order:

1. PCB/KiCad files for internal copper connections.
2. `firmware/node/include/Config.h` for firmware pins and tuning.
3. `firmware/node/platformio.ini` for the firmware build environment and dependencies.
4. `supabase/migrations/` for the deployed database shape.
5. These specs for intended behavior and external assembly.

Update the owning file only; link to it elsewhere instead of copying it.
