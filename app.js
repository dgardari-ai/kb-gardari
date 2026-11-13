(() => {
  'use strict';

  function init() {
    const content = window.KB_CONTENT || {};
    const dialogs = [...document.querySelectorAll('#detail-dialog, #agent-dialog, #contact-dialog')];
    const origins = new WeakMap();
    const detailDialog = document.getElementById('detail-dialog');
    const detailTitle = document.getElementById('detail-title');
    const detailBody = document.getElementById('detail-body');
    const contactDialog = document.getElementById('contact-dialog');
    const message = document.getElementById('project-message');
    const messageError = document.getElementById('project-message-error');
    const copyButton = document.getElementById('telegram-copy');
    const telegramReady = document.getElementById('telegram-ready');
    const telegramOpen = document.getElementById('telegram-open');
    let copyAttempt = 0;
    let telegramPrepared = false;

    function closeOtherDialogs(next) {
      dialogs.forEach(dialog => {
        if (dialog !== next && dialog.open) {
          origins.delete(dialog);
          dialog.close();
        }
      });
    }

    function openDialog(dialog, trigger) {
      if (!dialog || dialog.open) return;
      closeOtherDialogs(dialog);
      origins.set(dialog, trigger || document.activeElement);
      dialog.showModal();
      dialog.scrollTop = 0;
      if (dialog.id === 'agent-dialog') {
        // Keep keyboard focus in the dialog while its controls enter with the contour.
        dialog.tabIndex = -1;
        dialog.focus({ preventScroll: true });
      } else dialog.querySelector('[data-close-dialog]')?.focus({ preventScroll: true });
    }

    dialogs.forEach(dialog => {
      let pointerStartedOutside = false;
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
        const origin = origins.get(dialog);
        origins.delete(dialog);
        if (dialog === contactDialog) resetTelegram();
        if (origin?.isConnected && !dialogs.some(item => item.open)) origin.focus({ preventScroll: true });
      });
      // Escape uses the native dialog cancel/close behavior. No form sends data.
      dialog.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', event => event.preventDefault());
      });
    });

    function element(tag, text, className) {
      const node = document.createElement(tag);
      if (text !== undefined && text !== null) node.textContent = String(text);
      if (className) node.className = className;
      return node;
    }

    function paragraphs(parent, value, dynamicKey = null) {
      const entries = Array.isArray(value) ? value : [value];
      entries.forEach(entry => {
        if (typeof entry !== 'string') return;
        entry.split(/\n\s*\n/).filter(part => part.trim()).forEach(part => {
          const p = element('p');
          if (dynamicKey) p.dataset.kb2Dynamic = dynamicKey;
          part.split('\n').forEach((line, index) => {
            if (index) p.append(document.createElement('br'));
            p.append(document.createTextNode(line));
          });
          parent.append(p);
        });
      });
    }

    function textBlock(parent, heading, text) {
      if (!text) return;
      if (heading) parent.append(element('h3', heading));
      paragraphs(parent, text);
    }

    function showDetail(trigger, title, fill) {
      if (!detailDialog || !detailTitle || !detailBody) return;
      detailTitle.textContent = title || '';
      detailTitle.removeAttribute('data-kb2-dynamic');
      detailDialog.removeAttribute('data-kb2-precedent');
      detailBody.replaceChildren();
      fill(detailBody);
      openDialog(detailDialog, trigger);
    }

    function showCase(trigger) {
      const item = content.cases?.find(entry => entry.id === trigger.dataset.caseId);
      if (!item) return;
      showDetail(trigger, item.title, body => {
        const kind = [content.labels?.caseKind, item.label].filter(Boolean).join(' · ');
        if (kind) body.append(element('p', kind, 'detail-kind'));
        paragraphs(body, item.intro);
        textBlock(body, content.labels?.commissionHeading, item.commission);
        textBlock(body, content.labels?.resultHeading, item.result);
        textBlock(body, item.detailTitle, item.detailParagraphs);
        (item.detailFacts || []).forEach(fact => textBlock(body, fact.label, fact.text));
        if (content.labels?.caseNote) body.append(element('p', content.labels.caseNote, 'dialog-model-note'));
      });
    }

    function showPrecedent(trigger) {
      const item = content.precedents?.find(entry => entry.id === trigger.dataset.precedentId);
      if (!item) return;
      showDetail(trigger, item.question, body => {
        detailDialog.dataset.kb2Precedent = item.id;
        detailTitle.dataset.kb2Dynamic = 'question';
        if (item.category) {
          const category = element('p', item.category, 'detail-kind');
          category.dataset.kb2Dynamic = 'category';
          body.append(category);
        }
        paragraphs(body, item.thought, 'thought');
        (Array.isArray(item.paragraphs) ? item.paragraphs : [item.paragraphs])
          .forEach((text, index) => paragraphs(body, text, 'paragraph-' + index));
        const sources = element('div', null, 'precedent-sources');
        sources.setAttribute('aria-label', 'Источники');
        (item.sources || []).forEach((source, index) => {
          let url;
          try { url = new URL(source.url); } catch { return; }
          if (url.protocol !== 'https:') return;
          const link = element('a', source.label || source.url);
          link.dataset.kb2Dynamic = 'source-' + index;
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const p = element('p');
          p.append(link);
          sources.append(p);
        });
        if (sources.childElementCount) body.append(sources);
      });
    }

    function showProcess(trigger) {
      const value = trigger.dataset.processIndex;
      if (!/^[0-4]$/.test(value || '')) return;
      const item = content.process?.[Number(value)];
      if (item) showDetail(trigger, item.title, body => paragraphs(body, item.text));
    }

    function clearError() {
      if (messageError) messageError.hidden = true;
      message?.removeAttribute('aria-invalid');
    }

    function validateMessage() {
      if (!message) return false;
      if (message.value.trim()) { clearError(); return true; }
      if (messageError) {
        if (!messageError.textContent.trim()) messageError.textContent = 'Кратко опишите вашу задачу.';
        messageError.hidden = false;
      }
      message.setAttribute('aria-invalid', 'true');
      message.focus({ preventScroll: true });
      return false;
    }

    function resetTelegram() {
      copyAttempt += 1;
      telegramPrepared = false;
      if (copyButton) { copyButton.disabled = false; copyButton.hidden = true; }
      if (telegramOpen) telegramOpen.hidden = true;
      if (telegramReady) { telegramReady.textContent = ''; telegramReady.hidden = true; }
    }

    function prepareTelegram() {
      if (!validateMessage()) return;
      copyAttempt += 1;
      telegramPrepared = true;
      if (copyButton) { copyButton.disabled = false; copyButton.hidden = false; }
      if (telegramOpen) telegramOpen.hidden = false;
      if (telegramReady) {
        telegramReady.hidden = false;
        telegramReady.textContent = 'Скопируйте текст, откройте чат и вставьте сообщение. Отправку выполняете вы.';
      }
      copyButton?.focus({ preventScroll: true });
    }

    const preparedMessage = () => 'Запрос в КБ Гардари\n\n' + message.value.trim();

    function composeMail() {
      if (!validateMessage()) return;
      const link = element('a');
      link.href = 'mailto:denis@gardari.com?subject=' + encodeURIComponent('Задача для КБ Гардари')
        + '&body=' + encodeURIComponent(preparedMessage().replace(/\r?\n/g, '\r\n'));
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
    }

    async function copyTelegram() {
      if (!telegramPrepared || !validateMessage()) return;
      const attempt = ++copyAttempt;
      if (copyButton) copyButton.disabled = true;
      if (telegramReady) telegramReady.textContent = 'Копируем текст…';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(preparedMessage());
        if (attempt !== copyAttempt || !contactDialog?.open) return;
        if (telegramReady) telegramReady.textContent = 'Текст скопирован. Откройте чат, вставьте сообщение и отправьте его самостоятельно.';
      } catch {
        if (attempt !== copyAttempt || !contactDialog?.open) return;
        message.focus({ preventScroll: true });
        message.select();
        if (telegramReady) telegramReady.textContent = 'Автоматическое копирование недоступно. Скопируйте выделенный текст вручную и вставьте его в чат.';
      } finally {
        if (attempt === copyAttempt && copyButton) copyButton.disabled = false;
      }
    }

    if (telegramReady) {
      telegramReady.setAttribute('role', 'status');
      telegramReady.setAttribute('aria-live', 'polite');
    }
    if (message && messageError) {
      const ids = new Set((message.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(messageError.id);
      message.setAttribute('aria-describedby', [...ids].join(' '));
    }
    if (telegramOpen) {
      telegramOpen.href = 'https://t.me/denisgardari';
      telegramOpen.target = '_blank';
      telegramOpen.rel = 'noopener noreferrer';
      telegramOpen.addEventListener('click', event => {
        if (!telegramPrepared || !validateMessage()) event.preventDefault();
      });
    }
    message?.addEventListener('input', () => {
      clearError();
      if (!telegramPrepared) return;
      if (!message.value.trim()) { resetTelegram(); return; }
      copyAttempt += 1;
      if (copyButton) copyButton.disabled = false;
      if (telegramReady) telegramReady.textContent = 'Текст изменён. Скопируйте актуальный текст перед переходом в чат.';
    });
    resetTelegram();

    const actions = '[data-close-dialog], [data-case-id], [data-precedent-id], [data-process-index], '
      + '[data-open-agent], [data-open-contact], [data-compose-mail], [data-compose-telegram], #telegram-copy';
    document.addEventListener('click', event => {
      const trigger = event.target instanceof Element ? event.target.closest(actions) : null;
      if (!trigger) return;
      event.preventDefault();
      if (trigger.matches('[data-close-dialog]')) trigger.closest('dialog')?.close();
      else if (trigger.matches('[data-case-id]')) showCase(trigger);
      else if (trigger.matches('[data-precedent-id]')) showPrecedent(trigger);
      else if (trigger.matches('[data-process-index]')) showProcess(trigger);
      else if (trigger.matches('[data-open-agent]')) openDialog(document.getElementById('agent-dialog'), trigger);
      else if (trigger.matches('[data-open-contact]')) {
        clearError();
        resetTelegram();
        openDialog(contactDialog, trigger);
      } else if (trigger.matches('[data-compose-mail]')) composeMail();
      else if (trigger.matches('[data-compose-telegram]')) prepareTelegram();
      else if (trigger === copyButton) void copyTelegram();
    });

    function focusHashTarget() {
      if (!location.hash || location.hash === '#') return;
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target || target.closest('dialog')) return;
      const temporaryTabindex = !target.hasAttribute('tabindex')
        && !target.matches('a[href], button, input, select, textarea');
      if (temporaryTabindex) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (temporaryTabindex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      document.querySelectorAll('nav a[href^="#"]').forEach(link => {
        if (link.hash === location.hash) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
    // Native anchors retain deep links and browser history; no scroll animation is imposed.
    window.addEventListener('hashchange', focusHashTarget);
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', event => {
        if (!event.defaultPrevented && !link.matches(actions)) requestAnimationFrame(focusHashTarget);
      });
    });
    if (location.hash) requestAnimationFrame(focusHashTarget);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
