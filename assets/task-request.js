(() => {
  'use strict';
  const dialog = document.getElementById('task-request-dialog');
  const form = document.getElementById('task-request-form');
  const text = document.getElementById('task-request-text');
  const error = document.getElementById('task-request-error');
  if (!dialog || !form || !text || !error) return;
  let origin = null;

  const clearError = () => {
    error.hidden = true;
    text.removeAttribute('aria-invalid');
  };

  document.querySelectorAll('[data-open-task-request]').forEach(button => {
    button.addEventListener('click', () => {
      origin = button;
      clearError();
      dialog.showModal();
      dialog.scrollTop = 0;
      const focusTarget = window.matchMedia('(pointer: coarse)').matches
        ? dialog.querySelector('[data-close-task-request]') : text;
      focusTarget.focus({ preventScroll: true });
    });
  });

  text.addEventListener('input', clearError);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const channel = event.submitter?.value;
    if (channel !== 'email' && channel !== 'telegram') return;
    const task = text.value.trim();
    if (!task) {
      error.hidden = false;
      text.setAttribute('aria-invalid', 'true');
      text.focus({ preventScroll: true });
      return;
    }
    clearError();
    const message = 'Запрос в КБ Гардари\n\n' + task;
    const link = document.createElement('a');
    if (channel === 'email') {
      link.href = 'mailto:denis@gardari.com?subject=' + encodeURIComponent('Задача для КБ Гардари')
        + '&body=' + encodeURIComponent(message.replace(/\n/g, '\r\n'));
    } else {
      link.href = 'https://t.me/denisgardari?text=' + encodeURIComponent(message);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    // Navigation only prepares a draft; the visitor sends it in their own app.
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  });

  dialog.querySelectorAll('[data-close-task-request]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  });
})();
