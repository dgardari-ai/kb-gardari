(() => {
  'use strict';
  function init() {
    const dialog = document.getElementById('legal-dialog');
    const trigger = document.querySelector('[data-open-legal]');
    if (!dialog || !trigger) return;
    let origin = null, pointerStartedOutside = false;
    trigger.addEventListener('click', () => {
      if (dialog.open) return;
      origin = trigger;
      document.querySelectorAll('dialog[open]').forEach(other => { if (other !== dialog) other.close(); });
      dialog.showModal();
      dialog.scrollTop = 0;
      trigger.setAttribute('aria-expanded', 'true');
      dialog.querySelector('[data-close-legal]')?.focus({ preventScroll: true });
    });
    dialog.querySelector('[data-close-legal]')?.addEventListener('click', () => dialog.close());
    const outside = event => {
      const rect = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    dialog.addEventListener('pointerdown', event => { pointerStartedOutside = outside(event); });
    dialog.addEventListener('click', event => {
      if (pointerStartedOutside && outside(event)) dialog.close();
      pointerStartedOutside = false;
    });
    dialog.addEventListener('close', () => {
      trigger.setAttribute('aria-expanded', 'false');
      if (origin?.isConnected && !document.querySelector('dialog[open]')) origin.focus({ preventScroll: true });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
