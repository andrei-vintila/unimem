import { initTheme } from '~/composables/useTheme';

/**
 * Applies the stored theme preference to `<html>` before the app paints.
 * Client-only: the class depends on localStorage and a media query, neither of
 * which exists during prerender.
 */
export default defineNuxtPlugin(() => {
  initTheme();
});
