<template>
  <div class="flex min-h-svh min-w-0 items-center justify-center bg-default px-4 py-8">
    <main class="mx-auto grid w-full max-w-sm min-w-0 gap-5">
      <div class="grid justify-items-center gap-2">
        <NuxtLink to="/login" class="flex items-center gap-2.5 text-highlighted no-underline">
          <img src="/logo.svg" alt="" width="48" height="48" class="size-12" />
          <strong class="text-2xl font-semibold tracking-[-0.03em]">ExcaVision</strong>
        </NuxtLink>
        <p class="text-sm text-muted">Site movement monitoring</p>
      </div>
      <section class="rounded-xl border border-default bg-elevated p-6 shadow-sm"><slot /></section>
    </main>
  </div>
</template>
