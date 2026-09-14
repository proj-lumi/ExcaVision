# ExcaVision Customer — Nuxt UI PWA prototype

Independent frontend-only customer PWA for comparing Nuxt UI with the current Angular/Ionic app. It uses local JSON and does not connect to Supabase.

## Libraries used

| Library | Version | Purpose |
|---|---:|---|
| Nuxt | 4.5.2 | Vue application framework, routing, builds, and static generation |
| Nuxt UI | 4.11.1 | Accessible prebuilt navigation, form, modal, card, and feedback components |
| Tailwind CSS | 4.3.3 | Layout and responsive utility classes; element styling primarily comes from Nuxt UI |
| Lucide through Iconify | 1.2.132 icon set | Locally bundled interface icons |
| TypeScript | 5.9.3 | Typed application code |
| vue-tsc | 3.3.11 | Vue template and TypeScript validation |

Nuxt includes Vue 3 and Vue Router. Nuxt UI is built on Reka UI, Tailwind Variants, and Tailwind CSS; those are indirect dependencies rather than additional team choices.

### Nuxt UI components used

`UApp`, `UContainer`, `UButton`, `UIcon`, `UBadge`, `UAlert`, `UCard`, `UProgress`, `UModal`, `UFormField`, `UInput`, `USelect`, `UEmpty`, `URadioGroup`, and `UTextarea`.

The installable PWA behavior uses the browser's native web app manifest and Service Worker APIs. No PWA plugin, backend client, charting library, or external state library is used. Mock state uses Vue/Nuxt's built-in `useState`.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3002`.

The project includes a web app manifest and basic service worker. Mock changes reset when the page refreshes.
