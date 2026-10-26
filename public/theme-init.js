/*
 * Applies the saved appearance (System / Light / Dark) before the first paint, so a forced theme
 * never flashes the other one. Loaded as a classic, render-blocking script from the same origin,
 * which the Content-Security-Policy (script-src 'self') allows; no inline script is needed.
 * Keep the key and colours in sync with src/app/theme.ts.
 */
(function () {
  var theme = null;
  try {
    theme = window.localStorage.getItem('second-brain.theme');
  } catch (error) {
    theme = null;
  }
  if (theme !== 'light' && theme !== 'dark') {
    return;
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  var colour = theme === 'dark' ? '#0f0f10' : '#ffffff';
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i += 1) {
    metas[i].setAttribute('content', colour);
  }
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) {
    scheme.setAttribute('content', theme);
  }
})();
