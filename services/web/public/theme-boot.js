// Runs before the module graph loads so a visitor who chose a theme does not
// flash the other one. External (not inline) because the server's CSP allows
// scripts from 'self' only. Mirrors src/components/theme-provider.tsx: the
// stored value is "light" or "dark"; nothing stored means follow the OS.
(function () {
  try {
    var t = localStorage.getItem('microshort.theme');
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') {
      root.setAttribute('data-theme', t);
      root.classList.toggle('dark', t === 'dark');
    } else {
      root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  } catch (e) { /* storage blocked: follow the OS */ }
})();
