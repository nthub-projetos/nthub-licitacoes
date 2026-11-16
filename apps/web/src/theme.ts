import { computed, ref } from 'vue';

const theme = ref(
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
);

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark');
  function toggleTheme() {
    theme.value = isDark.value ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme.value;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark.value ? '#101522' : '#FFFFFF');
    try {
      localStorage.setItem('nthub.theme', theme.value);
    } catch {
      /* The theme remains usable when storage is unavailable. */
    }
  }
  return { isDark, toggleTheme };
}
