(() => {
  'use strict';
  const dialog = document.getElementById('task-request-dialog');
  const form = document.getElementById('task-request-form');
  const text = document.getElementById('task-request-text');
  const error = document.getElementById('task-request-error');
  if (!dialog || !form || !text || !error) return;
  const context = document.getElementById('task-request-context');
  const hint = document.getElementById('task-request-hint');
  const telegram = document.getElementById('task-request-telegram');
  const telegramText = document.getElementById('task-request-telegram-text');
  const copyButton = document.getElementById('task-request-copy');
  const copyStatus = document.getElementById('task-request-copy-status');
  const genericHint = hint?.textContent;
  const genericDescription = text.getAttribute('aria-describedby') || '';
  let origin = null;
  let participationContext = '';
  let copyAttempt = 0;

  const clearError = () => {
    error.hidden = true;
    text.removeAttribute('aria-invalid');
  };

  const resetCopyStatus = () => {
    copyAttempt += 1;
    if (copyButton) copyButton.disabled = false;
    if (copyStatus) copyStatus.textContent = '';
  };

  const resetTelegram = () => {
    resetCopyStatus();
    if (telegram) telegram.hidden = true;
    if (telegramText) telegramText.value = '';
  };

  const preparedMessage = () => 'Запрос в КБ Гардари\n\n'
    + (participationContext ? 'Способ участия: ' + participationContext + '\n\n' : '')
    + text.value.trim();

  document.querySelectorAll('[data-open-task-request]').forEach(button => {
    button.addEventListener('click', () => {
      origin = button;
      const article = document.getElementById(button.dataset.participationContext || '');
      const address = article?.matches('#participation article[data-address]')
        ? article.dataset.address.trim() : '';
      const title = article?.querySelector('h3')?.textContent.replace(/\s+/g, ' ').trim();
      participationContext = address && title ? address + ' · ' + title : '';
      if (context) {
        context.hidden = !participationContext;
        context.textContent = participationContext
          ? 'Вас заинтересовал способ участия: ' + participationContext : '';
      }
      if (hint) hint.textContent = participationContext
        ? 'Выберите, где продолжить. Для почты подготовим письмо, для Телеграма — текст, который можно скопировать и вставить в чат. Отправку выполняете вы.'
        : genericHint;
      text.setAttribute('aria-describedby', [participationContext && context ? context.id : '', genericDescription].filter(Boolean).join(' '));
      clearError();
      resetTelegram();
      dialog.showModal();
      dialog.scrollTop = 0;
      const focusTarget = window.matchMedia('(pointer: coarse)').matches
        ? dialog.querySelector('[data-close-task-request]') : text;
      focusTarget.focus({ preventScroll: true });
    });
  });

  text.addEventListener('input', () => {
    clearError();
    if (telegram && !telegram.hidden) {
      if (!text.value.trim()) resetTelegram();
      else {
        resetCopyStatus();
        telegramText.value = preparedMessage();
      }
    }
  });

  copyButton?.addEventListener('click', async () => {
    if (!telegramText || !copyStatus || !telegram || telegram.hidden) return;
    const attempt = ++copyAttempt;
    copyButton.disabled = true;
    copyStatus.textContent = 'Копируем текст…';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(telegramText.value);
      if (attempt !== copyAttempt || !dialog.open) return;
      copyStatus.textContent = 'Текст скопирован. Откройте чат, вставьте сообщение и отправьте его самостоятельно.';
    } catch {
      if (attempt !== copyAttempt || !dialog.open) return;
      telegramText.focus({ preventScroll: true });
      telegramText.select();
      copyStatus.textContent = 'Автоматическое копирование недоступно. Текст выделен: скопируйте его через меню устройства или сочетанием клавиш, затем вставьте в чат.';
    } finally {
      if (attempt === copyAttempt) copyButton.disabled = false;
    }
  });

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
    const message = preparedMessage();
    if (channel === 'telegram' && participationContext && telegram && telegramText) {
      resetCopyStatus();
      telegramText.value = message;
      telegram.hidden = false;
      telegramText.focus({ preventScroll: true });
      telegram.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      return;
    }
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
    resetTelegram();
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  });
})();
