(function () {
  'use strict';

  function isThai() {
    return document.documentElement.lang === 'th';
  }

  function setText(element, english, thai) {
    if (element) element.textContent = isThai() ? thai : english;
  }

  function improveDashboard(root) {
    const headCopy = root.querySelector('.page-head > div > p:not(.eyebrow)');
    setText(headCopy, 'A quick look at your space right now.', 'ดูบรรยากาศในพื้นที่ของคุณตอนนี้แบบสบาย ๆ');

    const metrics = root.querySelector('.metrics');
    if (metrics) {
      metrics.setAttribute('aria-label', isThai() ? 'ค่าล่าสุดจากพื้นที่' : 'Current room readings');
      const cards = [...metrics.querySelectorAll('.metric')];
      const copy = [
        ['Sound level now', 'ระดับเสียงตอนนี้'],
        ['What Mimi heard', 'เสียงที่ Mimi ได้ยิน'],
        ['Anyone nearby?', 'มีใครอยู่ใกล้ไหม'],
        ['Needs attention?', 'ต้องตรวจสอบไหม']
      ];
      cards.forEach((card, index) => {
        const item = copy[index];
        if (!item) return;
        setText(card.querySelector('.label'), item[0], item[1]);
        card.setAttribute('aria-label', isThai() ? item[1] : item[0]);
      });
    }

    const alert = root.querySelector('.alert-note');
    if (alert) {
      alert.setAttribute('role', 'status');
      alert.setAttribute('aria-live', 'polite');
      alert.setAttribute('aria-atomic', 'true');
    }

    const context = root.querySelector('.device-context');
    if (context) context.setAttribute('aria-label', isThai() ? 'อุปกรณ์และสถานะการเชื่อมต่อ' : 'Device and connection status');

    root.querySelectorAll('.dashboard-grid > .panel').forEach((panel, index) => {
      const heading = panel.querySelector('h2');
      if (!heading) return;
      if (!heading.id) heading.id = `dashboard-panel-${index + 1}`;
      panel.setAttribute('aria-labelledby', heading.id);
    });
  }

  function improvePage(root) {
    if (!root) return;
    document.querySelectorAll('.nav button[data-page]').forEach(button => {
      const current = button.dataset.page === root.dataset.page;
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    root.querySelectorAll('svg').forEach(svg => svg.setAttribute('focusable', 'false'));
    if (root.dataset.page === 'dashboard') improveDashboard(root);
  }

  const originalRender = window.render;
  if (typeof originalRender === 'function') {
    window.render = function (...args) {
      const result = originalRender.apply(this, args);
      improvePage(document.getElementById('content'));
      return result;
    };
  }

  improvePage(document.getElementById('content'));
})();
