# ExcaVision Admin — Nuxt UI prototype

Independent frontend-only staff dashboard for comparing Nuxt UI with the current Angular Admin. It uses local JSON and does not connect to Supabase.

## Libraries used

| Library | Version | Purpose |
|---|---:|---|
| Nuxt | 4.5.2 | Vue application framework, routing, builds, and static generation |
| Nuxt UI | 4.11.1 | Accessible prebuilt dashboard, navigation, form, table, modal, card, and feedback components |
| Tailwind CSS | 4.3.3 | Layout and responsive utility classes; element styling primarily comes from Nuxt UI |
| Lucide through Iconify | 1.2.132 icon set | Locally bundled interface icons |
| TypeScript | 5.9.3 | Typed application code |
| vue-tsc | 3.3.11 | Vue template and TypeScript validation |

Nuxt includes Vue 3 and Vue Router. Nuxt UI is built on Reka UI, Tailwind Variants, and Tailwind CSS; those are indirect dependencies rather than additional team choices.

### Nuxt UI components used

`UApp`, `UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`, `UNavigationMenu`, `UAvatar`, `UButton`, `UBadge`, `UCard`, `UAlert`, `UProgress`, `UTabs`, `UInput`, `USelect`, `UEmpty`, `UModal`, and `UTable`.

No backend client, charting library, external state library, or custom component framework is used. Mock state uses Vue/Nuxt's built-in `useState`.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3001`.

Mock changes reset when the page refreshes.
