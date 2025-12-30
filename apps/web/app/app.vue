<script setup lang="ts">
// Initialize app-level concerns
useHead({
  htmlAttrs: { lang: 'en' },
  bodyAttrs: { class: 'min-h-screen' },
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
