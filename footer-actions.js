(() => {
  'use strict';
  const start = () => {
    const button = document.querySelector('[data-share-site]');
    const status = document.querySelector('[data-share-status]');
    if (!button || !status) return;
    let busy = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      status.textContent = '';
      // Share the current site root, preserving the GitHub Pages prefix.
      const url = new URL('./', location.href).href;
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: document.title, url });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          status.textContent = 'Ссылка скопирована';
        } else {
          status.textContent = url;
        }
      } catch (error) {
        if (error?.name !== 'AbortError') status.textContent = url;
      } finally {
        busy = false;
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
