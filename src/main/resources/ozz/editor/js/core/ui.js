/* PoseForge UI primitives: buttons, menus, context menus, modals, toasts, sections. ES5. */
(function (global, OZ) {
  'use strict';
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;

  function overlayRoot() {
    var root = document.getElementById('overlay-root');
    if (!root) {
      root = el('div', 'oz-overlay-root');
      root.id = 'overlay-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function button(opts) {
    opts = opts || {};
    var cls = 'oz-btn';
    if (opts.variant) cls += ' oz-btn-' + opts.variant;
    if (opts.size) cls += ' oz-btn-' + opts.size;
    if (opts.active) cls += ' active';
    if (opts.block) cls += ' oz-btn-block';
    var b = el('button', cls);
    b.type = 'button';
    if (opts.title) b.setAttribute('title', opts.title);
    if (opts.icon) {
      var ic = icon(opts.icon, opts.iconSize || 13);
      OZ.dom.addClass(ic, 'oz-btn-ico');
      b.appendChild(ic);
    }
    if (opts.label) b.appendChild(el('span', 'oz-btn-label', opts.label));
    if (opts.disabled) b.disabled = true;
    if (typeof opts.onClick === 'function') {
      OZ.dom.on(b, 'click', function (ev) {
        if (b.disabled) return;
        OZ.event.stop(ev);
        opts.onClick(ev);
      });
    }
    return b;
  }

  function iconButton(name, title, onClick, opts) {
    opts = opts || {};
    var cls = 'oz-icon-btn' + (opts.active ? ' active' : '') + (opts.size ? ' oz-icon-btn-' + opts.size : '');
    var b = el('button', cls);
    b.type = 'button';
    if (title) { b.setAttribute('title', title); b.setAttribute('aria-label', title); }
    b.appendChild(icon(name, opts.iconSize || 14));
    b.disabled = !!opts.disabled;
    if (typeof onClick === 'function') {
      OZ.dom.on(b, 'click', function (ev) {
        if (b.disabled) return;
        OZ.event.stop(ev);
        onClick(ev);
      });
    }
    return b;
  }

  var openMenus = [];
  function closeAllMenus(except) {
    for (var i = openMenus.length - 1; i >= 0; i--) {
      if (openMenus[i] !== except) {
        try { openMenus[i].close(); } catch (e) {}
      }
    }
  }

  function menu(x, y, items, opts) {
    opts = opts || {};
    closeAllMenus();
    var box = el('div', 'oz-menu');
    box.id = 'oz-menu-' + (OZ.util.uid('m').replace(/[^a-z0-9_]/gi, ''));
    if (opts.minWidth) OZ.dom.setStyle(box, 'minWidth', opts.minWidth + 'px');
    var closed = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      if (it.sep) { box.appendChild(el('div', 'oz-menu-sep')); continue; }
      if (it.header) { box.appendChild(el('div', 'oz-menu-header', it.header)); continue; }
      var row = el('div', 'oz-menu-item');
      if (it.disabled) row.className += ' disabled';
      if (it.danger) row.className += ' danger';
      if (it.icon) {
        var ic = icon(it.icon, 13);
        OZ.dom.addClass(ic, 'oz-menu-ico');
        row.appendChild(ic);
      } else {
        row.appendChild(el('span', 'oz-menu-ico-spacer'));
      }
      row.appendChild(el('span', 'oz-menu-label', it.label));
      if (it.shortcut) row.appendChild(el('span', 'oz-menu-shortcut', it.shortcut));
      if (it.checked) {
        var chk = icon('check', 12);
        OZ.dom.addClass(chk, 'oz-menu-check');
        row.appendChild(chk);
      }
      if (!it.disabled && typeof it.onClick === 'function') {
        (function (item) {
          OZ.dom.on(row, 'click', function (ev) {
            OZ.event.stop(ev);
            api.close();
            item.onClick(ev);
          });
        })(it);
      }
      box.appendChild(row);
    }
    overlayRoot().appendChild(box);

    function place() {
      var r = OZ.dom.rect(box);
      var vw = global.innerWidth || document.documentElement.clientWidth || 800;
      var vh = global.innerHeight || document.documentElement.clientHeight || 600;
      var px = x, py = y;
      if (opts.anchorEl) {
        var ar = OZ.dom.rect(opts.anchorEl);
        py = ar.bottom + 4;
        px = opts.alignRight ? ar.right - r.width : ar.x;
      }
      if (px + r.width > vw - 6) px = vw - r.width - 6;
      if (py + r.height > vh - 6) {
        if (opts.anchorEl) py = OZ.dom.rect(opts.anchorEl).y - r.height - 4;
        else py = vh - r.height - 6;
      }
      if (px < 6) px = 6;
      if (py < 6) py = 6;
      OZ.dom.setStyle(box, 'left', Math.round(px) + 'px');
      OZ.dom.setStyle(box, 'top', Math.round(py) + 'px');
    }
    place();
    OZ.dom.afterLayout(place);

    function onDown(ev) {
      if (box.contains(ev.target)) return;
      api.close();
    }
    function onKey(ev) {
      if (OZ.event.key(ev) === 'Esc') { OZ.event.stop(ev); api.close(); }
    }
    var api = {
      el: box,
      close: function () {
        if (closed) return;
        closed = true;
        OZ.dom.off(document, 'mousedown', onDown, true);
        OZ.dom.off(document, 'keydown', onKey, true);
        var idx = openMenus.indexOf(api);
        if (idx >= 0) openMenus.splice(idx, 1);
        if (box.parentNode) box.parentNode.removeChild(box);
        if (opts.onClose) opts.onClose();
      }
    };
    openMenus.push(api);
    setTimeout(function () {
      if (!closed) {
        OZ.dom.on(document, 'mousedown', onDown, true);
        OZ.dom.on(document, 'keydown', onKey, true);
      }
    }, 0);
    return api;
  }

  function contextMenu(ev, items, opts) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (ev && ev.stopPropagation) ev.stopPropagation();
    var p = OZ.event.pos(ev || { clientX: 0, clientY: 0 });
    return menu(p.x, p.y, items, opts);
  }

  var modalStack = [];
  function modal(opts) {
    opts = opts || {};
    var backdrop = el('div', 'oz-modal-backdrop');
    var box = el('div', 'oz-modal');
    if (opts.width) OZ.dom.setStyle(box, 'width', opts.width + 'px');
    var header = el('div', 'oz-modal-head');
    var titleWrap = el('div', 'oz-modal-title-wrap');
    titleWrap.appendChild(el('div', 'oz-modal-title', opts.title || ''));
    if (opts.subtitle) titleWrap.appendChild(el('div', 'oz-modal-subtitle', opts.subtitle));
    header.appendChild(titleWrap);
    var closeBtn = iconButton('close', '关闭', function () { api.close(); }, { iconSize: 13 });
    closeBtn.className += ' oz-modal-close';
    header.appendChild(closeBtn);
    box.appendChild(header);

    var body = el('div', 'oz-modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    box.appendChild(body);

    var footer = null;
    if (opts.footer && opts.footer.length) {
      footer = el('div', 'oz-modal-foot');
      for (var i = 0; i < opts.footer.length; i++) {
        (function (it) {
          var b = button({
            label: it.label,
            variant: it.variant || '',
            size: it.size || '',
            onClick: function () {
              var result = null;
              if (it.onClick) result = it.onClick(api.close);
              if (it.closeOnClick === false || result === false) return;
              api.close();
            }
          });
          footer.appendChild(b);
        })(opts.footer[i]);
      }
      box.appendChild(footer);
    }
    backdrop.appendChild(box);
    overlayRoot().appendChild(backdrop);
    OZ.dom.afterLayout(function () { backdrop.className += ' open'; });

    function onKey(ev) {
      if (OZ.event.key(ev) === 'Esc') { OZ.event.stop(ev); api.close(); }
      if (OZ.event.key(ev) === 'Enter' && opts.enterOk && footer) {
        var first = footer.querySelector('.oz-btn-primary');
        if (first) { OZ.event.stop(ev); first.click(); }
      }
    }
    function onBackdrop(ev) {
      if (ev.target === backdrop) api.close();
    }
    var closed = false;
    var api = {
      el: box,
      body: body,
      close: function () {
        if (closed) return;
        closed = true;
        OZ.dom.off(document, 'keydown', onKey, true);
        OZ.dom.off(backdrop, 'click', onBackdrop);
        var idx = modalStack.indexOf(api);
        if (idx >= 0) modalStack.splice(idx, 1);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (opts.onClose) opts.onClose();
      }
    };
    modalStack.push(api);
    OZ.dom.on(document, 'keydown', onKey, true);
    OZ.dom.on(backdrop, 'click', onBackdrop);
    var focusEl = body.querySelector('input, textarea, select');
    if (focusEl && focusEl.focus) setTimeout(function () { focusEl.focus(); }, 30);
    return api;
  }

  function confirm(opts) {
    opts = opts || {};
    var confirmed = false;
    modal({
      title: opts.title || '确认',
      body: el('div', 'oz-modal-text', opts.message || ''),
      width: opts.width || 440,
      footer: [
        { label: opts.cancelLabel || '取消', variant: 'ghost' },
        {
          label: opts.okLabel || '确定', variant: opts.danger ? 'danger' : 'primary',
          onClick: function () {
            confirmed = true;
            if (opts.onOk) opts.onOk();
          }
        }
      ],
      onClose: function () {
        if (!confirmed && opts.onCancel) opts.onCancel();
      }
    });
  }

  function prompt(opts) {
    opts = opts || {};
    var wrap = el('div', 'oz-prompt');
    if (opts.label) wrap.appendChild(el('div', 'oz-prompt-label', opts.label));
    var input;
    if (opts.multiline) {
      input = el('textarea', 'oz-textarea');
      input.setAttribute('rows', String(opts.rows || 5));
    } else {
      input = el('input', 'oz-input');
      input.type = 'text';
    }
    input.value = opts.value == null ? '' : String(opts.value);
    if (opts.placeholder) input.placeholder = opts.placeholder;
    wrap.appendChild(input);
    if (opts.help) wrap.appendChild(el('div', 'oz-prompt-help', opts.help));
    var errorEl = el('div', 'oz-prompt-error');
    wrap.appendChild(errorEl);
    var m = modal({
      title: opts.title || '输入',
      body: wrap,
      width: opts.width || 480,
      enterOk: true,
      footer: [
        { label: '取消', variant: 'ghost' },
        {
          label: opts.okLabel || '确定', variant: 'primary',
          onClick: function (close) {
            var v = input.value;
            if (opts.validate) {
              var err = opts.validate(v);
              if (err) {
                errorEl.textContent = err;
                return false;
              }
            }
            if (opts.onOk) opts.onOk(v);
            close();
          }
        }
      ]
    });
    setTimeout(function () {
      if (input.focus) input.focus();
      if (input.select) input.select();
    }, 40);
    return m;
  }

  var toastStack = null;
  function toast(text, type, ms) {
    if (!toastStack) {
      toastStack = el('div', 'oz-toast-stack');
      overlayRoot().appendChild(toastStack);
    }
    var t = el('div', 'oz-toast' + (type ? ' oz-toast-' + type : ''));
    t.appendChild(icon(type === 'danger' ? 'warning' : type === 'success' ? 'check' : 'info', 13));
    t.appendChild(el('span', 'oz-toast-text', text));
    toastStack.appendChild(t);
    OZ.dom.afterLayout(function () { t.className += ' show'; });
    var duration = ms || (type === 'danger' ? 4200 : 2400);
    setTimeout(function () {
      t.className = t.className.replace(/\s*show/, '');
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 260);
    }, duration);
    return t;
  }

  function emptyState(title, text, actions) {
    var box = el('div', 'oz-empty');
    box.appendChild(el('div', 'oz-empty-icon')).appendChild(icon('sparkle', 26));
    box.appendChild(el('div', 'oz-empty-title', title || ''));
    if (text) box.appendChild(el('div', 'oz-empty-text', text));
    if (actions && actions.length) {
      var row = el('div', 'oz-empty-actions');
      for (var i = 0; i < actions.length; i++) row.appendChild(actions[i]);
      box.appendChild(row);
    }
    return box;
  }

  function kv(pairs) {
    var box = el('div', 'oz-kv');
    for (var i = 0; i < pairs.length; i++) {
      var row = el('div', 'oz-kv-row');
      row.appendChild(el('span', 'oz-kv-key', pairs[i][0]));
      row.appendChild(el('span', 'oz-kv-value', pairs[i][1]));
      box.appendChild(row);
    }
    return box;
  }

  function section(title, opts) {
    opts = opts || {};
    var box = el('div', 'oz-section');
    var head = el('div', 'oz-section-head');
    var body = el('div', 'oz-section-body');
    var open = opts.open !== false;
    function paint() {
      OZ.dom.clear(head);
      head.appendChild(icon(open ? 'chevron-down' : 'chevron-right', 12));
      head.appendChild(el('span', 'oz-section-title', title));
      if (opts.extra) head.appendChild(opts.extra);
      OZ.dom.toggleClass(box, 'collapsed', !open);
    }
    paint();
    box.appendChild(head);
    box.appendChild(body);
    OZ.dom.on(head, 'click', function (ev) {
      if (ev.target !== head && ev.target.parentNode !== head) return;
      open = !open;
      paint();
      if (opts.onToggle) opts.onToggle(open);
    });
    return { el: box, head: head, body: body, isOpen: function () { return open; } };
  }

  function makeDockResizable(dock, opts) {
    opts = opts || {};
    var handle = dock.querySelector('.oz-dock-resize');
    if (!handle) return;
    var dragging = false;
    var startY = 0, startH = 0;
    function down(ev) {
      dragging = true;
      startY = ev.clientY;
      startH = OZ.dom.rect(dock).height;
      OZ.dom.addClass(document.body, 'oz-resizing');
      OZ.event.stop(ev);
      OZ.dom.on(document, 'mousemove', move, true);
      OZ.dom.on(document, 'mouseup', up, true);
    }
    function move(ev) {
      if (!dragging) return;
      var dy = ev.clientY - startY;
      var h = startH - dy;
      var min = opts.min || 120;
      var max = opts.max || Math.max(min, (global.innerHeight || 720) * 0.7);
      h = OZ.util.clamp(h, min, max);
      OZ.dom.setStyle(dock, 'height', Math.round(h) + 'px');
      if (opts.onResize) opts.onResize(h);
      if (ev.preventDefault) ev.preventDefault();
    }
    function up() {
      dragging = false;
      OZ.dom.removeClass(document.body, 'oz-resizing');
      OZ.dom.off(document, 'mousemove', move, true);
      OZ.dom.off(document, 'mouseup', up, true);
      if (opts.onResizeEnd) opts.onResizeEnd(OZ.dom.rect(dock).height);
    }
    OZ.dom.on(handle, 'mousedown', down);
  }

  OZ.ui = {
    overlayRoot: overlayRoot,
    button: button,
    iconButton: iconButton,
    menu: menu,
    contextMenu: contextMenu,
    closeMenus: function () { closeAllMenus(); },
    modal: modal,
    confirm: confirm,
    prompt: prompt,
    toast: toast,
    empty: emptyState,
    kv: kv,
    section: section,
    makeDockResizable: makeDockResizable,
    icon: icon
  };
})(OZ.host, OZ);
