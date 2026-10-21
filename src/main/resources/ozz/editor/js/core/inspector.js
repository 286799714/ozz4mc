/* Inspector panel renderer. Schema-driven per docs/CONTRACTS.md §4.4. ES5. */
(function (global, OZ) {
  'use strict';
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;

  function create() {
    var root = null;
    var headTitle = null;
    var headSubtitle = null;
    var body = null;
    var openState = {};
    var lastSpec = null;

    function init(container) {
      root = container;
      OZ.dom.clear(root);
      var head = el('div', 'oz-insp-head');
      var wrap = el('div', 'oz-insp-title-wrap');
      headTitle = el('div', 'oz-insp-title', '检查器');
      headSubtitle = el('div', 'oz-insp-subtitle', '');
      wrap.appendChild(headTitle);
      wrap.appendChild(headSubtitle);
      head.appendChild(wrap);
      var pin = el('div', 'oz-insp-pin');
      pin.appendChild(icon('sliders', 14));
      head.appendChild(pin);
      root.appendChild(head);
      body = el('div', 'oz-insp-body oz-scroll');
      root.appendChild(body);
      empty('未选择对象');
      return api;
    }

    function setHead(title, subtitle) {
      if (!headTitle) return;
      headTitle.textContent = title || '检查器';
      headSubtitle.textContent = subtitle || '';
      if (subtitle) OZ.dom.addClass(headSubtitle, 'visible');
      else OZ.dom.removeClass(headSubtitle, 'visible');
    }

    function empty(msg) {
      if (!body) return;
      OZ.dom.clear(body);
      var box = el('div', 'oz-insp-empty');
      box.appendChild(icon('target', 22));
      box.appendChild(el('div', 'oz-insp-empty-text', msg || '未选择对象'));
      body.appendChild(box);
      setHead('检查器', '');
    }

    function fieldRow(field) {
      var row = el('div', 'oz-field');
      if (field.type === 'slider' || field.type === 'textarea' || field.type === 'custom' ||
          field.type === 'kv' || field.type === 'button' || field.type === 'info') {
        row.className += ' oz-field-vertical';
      }
      if (field.label && field.type !== 'kv' && field.type !== 'button' && field.type !== 'divider' && field.type !== 'slider') {
        row.appendChild(el('div', 'oz-field-label', field.label));
      }
      var ctrl = el('div', 'oz-field-control');
      row.appendChild(ctrl);
      if (field.help) {
        var help = el('div', 'oz-field-help', field.help);
        row.appendChild(help);
      }
      return { row: row, ctrl: ctrl };
    }

    function addChange(input, field) {
      function fire() {
        if (typeof field.onChange !== 'function') return;
        var v = input.value;
        if (field.type === 'number' || field.type === 'slider') {
          v = parseFloat(v);
          if (isNaN(v)) return;
          if (typeof field.min === 'number' && v < field.min) v = field.min;
          if (typeof field.max === 'number' && v > field.max) v = field.max;
        }
        if (field.type === 'toggle') v = !!input.checked;
        field.onChange(v);
      }
      if (field.type === 'number') {
        OZ.dom.on(input, 'change', fire);
        OZ.dom.on(input, 'keydown', function (ev) {
          if (ev.key === 'Enter') { fire(); if (input.blur) input.blur(); }
        });
      } else if (field.type === 'slider') {
        OZ.dom.on(input, 'input', fire);
        OZ.dom.on(input, 'change', fire);
      } else if (field.type === 'toggle') {
        OZ.dom.on(input, 'change', fire);
      } else {
        OZ.dom.on(input, 'change', fire);
        if (field.live) OZ.dom.on(input, 'input', fire);
        OZ.dom.on(input, 'keydown', function (ev) {
          if (ev.key === 'Enter' && field.type !== 'textarea') { fire(); if (input.blur) input.blur(); }
        });
      }
    }

    function renderField(field) {
      if (!field) return null;
      if (field.type === 'divider') return el('div', 'oz-divider');
      if (field.type === 'kv') {
        var box = el('div', 'oz-field-control');
        box.appendChild(OZ.ui.kv(field.items || []));
        var wrap = el('div', 'oz-field oz-field-vertical');
        wrap.appendChild(box);
        return wrap;
      }
      if (field.type === 'button') {
        var b = OZ.ui.button({
          label: field.label,
          variant: field.variant || 'ghost',
          icon: field.icon || '',
          block: true,
          onClick: field.onClick
        });
        var bwrap = el('div', 'oz-field oz-field-vertical');
        bwrap.appendChild(b);
        return bwrap;
      }
      if (field.type === 'info') {
        var iwrap = el('div', 'oz-field oz-field-vertical');
        iwrap.appendChild(el('div', 'oz-field-info', field.text || ''));
        return iwrap;
      }
      if (field.type === 'custom') {
        var cwrap = el('div', 'oz-field oz-field-vertical');
        var host = el('div', 'oz-field-custom');
        cwrap.appendChild(host);
        field.render(host);
        return cwrap;
      }
      var parts = fieldRow(field);
      var input;
      if (field.type === 'text') {
        input = el('input', 'oz-input');
        input.type = 'text';
        input.value = field.value == null ? '' : String(field.value);
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.disabled) input.disabled = true;
        parts.ctrl.appendChild(input);
        addChange(input, field);
      } else if (field.type === 'number') {
        var numWrap = el('div', 'oz-number-wrap');
        input = el('input', 'oz-input oz-input-number');
        input.type = 'number';
        if (typeof field.min === 'number') input.setAttribute('min', String(field.min));
        if (typeof field.max === 'number') input.setAttribute('max', String(field.max));
        if (typeof field.step === 'number') input.setAttribute('step', String(field.step));
        input.value = field.value == null ? '' : String(field.value);
        if (field.disabled) input.disabled = true;
        numWrap.appendChild(input);
        if (field.unit) numWrap.appendChild(el('span', 'oz-unit', field.unit));
        parts.ctrl.appendChild(numWrap);
        addChange(input, field);
      } else if (field.type === 'slider') {
        var headRow = el('div', 'oz-slider-head');
        headRow.appendChild(el('span', 'oz-field-label', field.label || ''));
        var readout = el('span', 'oz-slider-value', OZ.util.fmtNum(Number(field.value) || 0, field.digits == null ? 2 : field.digits));
        headRow.appendChild(readout);
        var rangeWrap = el('div', 'oz-slider-row');
        input = el('input', 'oz-range');
        input.type = 'range';
        input.setAttribute('min', String(typeof field.min === 'number' ? field.min : 0));
        input.setAttribute('max', String(typeof field.max === 'number' ? field.max : 1));
        input.setAttribute('step', String(typeof field.step === 'number' ? field.step : 0.01));
        input.value = field.value == null ? 0 : field.value;
        if (field.disabled) input.disabled = true;
        rangeWrap.appendChild(input);
        var sliderInner = el('div', 'oz-slider-inner');
        sliderInner.appendChild(headRow);
        sliderInner.appendChild(rangeWrap);
        parts.ctrl.appendChild(sliderInner);
        OZ.dom.on(input, 'input', function () {
          readout.textContent = OZ.util.fmtNum(parseFloat(input.value), field.digits == null ? 2 : field.digits);
        });
        addChange(input, field);
      } else if (field.type === 'select') {
        input = el('select', 'oz-select');
        var opts = field.options || [];
        for (var i = 0; i < opts.length; i++) {
          var o = el('option', '', opts[i].label == null ? String(opts[i].value) : opts[i].label);
          o.value = String(opts[i].value);
          if (String(opts[i].value) === String(field.value)) o.selected = true;
          input.appendChild(o);
        }
        if (field.disabled) input.disabled = true;
        parts.ctrl.appendChild(input);
        addChange(input, field);
      } else if (field.type === 'toggle') {
        var label = el('label', 'oz-check-wrap');
        input = el('input', 'oz-check');
        input.type = 'checkbox';
        input.checked = !!field.value;
        if (field.disabled) input.disabled = true;
        label.appendChild(input);
        label.appendChild(el('span', 'oz-check-text', field.toggleLabel || '启用'));
        parts.ctrl.appendChild(label);
        addChange(input, field);
      } else if (field.type === 'textarea') {
        input = el('textarea', 'oz-textarea');
        input.setAttribute('rows', String(field.rows || 3));
        input.value = field.value == null ? '' : String(field.value);
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.disabled) input.disabled = true;
        parts.ctrl.appendChild(input);
        addChange(input, field);
      } else {
        parts.ctrl.appendChild(el('div', 'oz-field-readonly', field.value == null ? '—' : String(field.value)));
      }
      return parts.row;
    }

    function render(spec) {
      if (!body) return;
      lastSpec = spec;
      OZ.dom.clear(body);
      setHead(spec.title || '检查器', spec.subtitle || '');
      var sections = spec.sections || [];
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        var key = spec.title + '::' + (s.title || i);
        var open = openState.hasOwnProperty(key) ? openState[key] : s.open !== false;
        var sec = OZ.ui.section(s.title || '', { open: open });
        openState[key] = open;
        (function (sectionKey, sectionEl) {
          OZ.dom.on(sectionEl.head, 'click', function () { openState[sectionKey] = sectionEl.isOpen(); });
        })(key, sec);
        if (s.extra) sec.head.appendChild(s.extra);
        var fields = s.fields || [];
        for (var j = 0; j < fields.length; j++) {
          var row = renderField(fields[j]);
          if (row) sec.body.appendChild(row);
        }
        body.appendChild(sec.el);
      }
      if (!sections.length) {
        body.appendChild(el('div', 'oz-insp-hint', '该对象没有可编辑属性'));
      }
    }

    var api = {
      init: init,
      render: render,
      empty: empty,
      refresh: function () { if (lastSpec) render(lastSpec); },
      root: function () { return root; }
    };
    return api;
  }

  OZ.Inspector = { create: create };
})(OZ.host, OZ);
