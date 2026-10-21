/* PoseForge compat/util layer. ES5 only — runs in Chrome and AUI (Rhino). */
var OZ = {};

(function (nativeWindow, OZ) {
  'use strict';

  // AUI's window is a Java object, while its page globals live in Rhino's
  // document scope. Keep application state in OZ and expose only host services.
  // Wrappers also keep detached rAF/timer calls bound to their native receiver.
  var global = OZ.host = {
    console: typeof console !== 'undefined' ? console : null,
    ResizeObserver: typeof ResizeObserver === 'function' ? ResizeObserver : null,
    setTimeout: function (fn, delay) { return setTimeout(function () { if (isCurrentDocument()) fn(); }, delay); },
    clearTimeout: function (id) { clearTimeout(id); },
    requestAnimationFrame: function (fn) {
      var callback = function (time) { if (isCurrentDocument()) fn(time); };
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
      return setTimeout(function () { callback(Date.now()); }, 16);
    },
    cancelAnimationFrame: function (id) {
      if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
      } else clearTimeout(id);
    },
    getComputedStyle: function (node) { return getComputedStyle(node); },
    addEventListener: function (type, fn, capture) {
      nativeWindow.addEventListener(type, fn, capture === true);
    },
    removeEventListener: function (type, fn, capture) {
      nativeWindow.removeEventListener(type, fn, capture === true);
    }
  };
  Object.defineProperty(global, 'localStorage', {
    get: function () { return typeof localStorage !== 'undefined' ? localStorage : null; }
  });
  Object.defineProperty(global, 'location', {
    get: function () { return document.location || nativeWindow.location; }
  });
  Object.defineProperty(global, 'innerWidth', {
    get: function () { return nativeWindow.innerWidth; }
  });
  Object.defineProperty(global, 'innerHeight', {
    get: function () { return nativeWindow.innerHeight; }
  });
  Object.defineProperty(global, 'devicePixelRatio', {
    get: function () { return nativeWindow.devicePixelRatio; }
  });
  var isAUI = typeof document.getBaseURI === 'function';
  var ownerDocument = document;
  var generation = isAUI && typeof document.getRefreshGeneration === 'function'
    ? Number(document.getRefreshGeneration()) : null;
  function isCurrentDocument() {
    return !isAUI || generation === null || ownerDocument.isCurrentGeneration(generation);
  }
  var dpr = 1;
  try {
    dpr = global.devicePixelRatio || 1;
    if (isAUI && dpr > 1.5) dpr = 1;
    if (dpr > 2) dpr = 2;
  } catch (e2) {}

  OZ.env = {
    isAUI: isAUI,
    isCurrentDocument: isCurrentDocument,
    dpr: dpr,
    platform: typeof navigator !== 'undefined' ? navigator.platform || '' : ''
  };

  function uid(prefix) {
    uid.n = (uid.n || 0) + 1;
    return (prefix || 'id_') + Date.now().toString(36) + '_' + uid.n;
  }

  var util = {
    uid: uid,
    clone: function (v) { return JSON.parse(JSON.stringify(v)); },
    extend: function (dst, src) {
      if (!src) return dst;
      for (var k in src) if (src.hasOwnProperty(k)) dst[k] = src[k];
      return dst;
    },
    clamp: function (v, min, max) {
      if (typeof min === 'number' && v < min) v = min;
      if (typeof max === 'number' && v > max) v = max;
      return v;
    },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smoothstep: function (t) {
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return t * t * (3 - 2 * t);
    },
    snap: function (v, step) {
      if (!step) return v;
      return Math.round(v / step) * step;
    },
    pad2: function (n) { return (n < 10 ? '0' : '') + n; },
    fmtNum: function (v, digits) {
      if (typeof v !== 'number' || isNaN(v)) return '—';
      var d = typeof digits === 'number' ? digits : 2;
      return v.toFixed(d);
    },
    fmtTime: function (sec, fps) {
      if (typeof sec !== 'number' || isNaN(sec)) sec = 0;
      var neg = sec < 0;
      if (neg) sec = -sec;
      var m = Math.floor(sec / 60);
      var s = sec - m * 60;
      var out;
      if (fps) {
        var frames = Math.floor((s - Math.floor(s)) * fps + 0.0001);
        out = m + ':' + (Math.floor(s) < 10 ? '0' : '') + Math.floor(s) + '.' + (frames < 10 ? '0' : '') + frames;
      } else {
        out = m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
      }
      return (neg ? '-' : '') + out;
    },
    startsWith: function (s, p) { return String(s).indexOf(p) === 0; },
    endsWith: function (s, p) {
      s = String(s);
      return s.length >= p.length && s.substring(s.length - p.length) === p;
    },
    indexOfBy: function (arr, key, value) {
      for (var i = 0; i < (arr || []).length; i++) if (arr[i][key] === value) return i;
      return -1;
    },
    deepEqual: function (a, b) {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
    },
    debounce: function (fn, ms) {
      var timer = null;
      return function () {
        var self = this, args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; fn.apply(self, args); }, ms);
      };
    },
    escapeHtml: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    round: function (v, digits) {
      var p = Math.pow(10, digits || 0);
      return Math.round(v * p) / p;
    }
  };

  function el(tag, className, text) {
    var node;
    if (isAUI) {
      // Parse the concrete AUI element up front. Appending a generic Element
      // replaces it with a typed instance and leaves cached JS references stale.
      var holder = document.createElement('div');
      var isVoid = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag);
      holder.innerHTML = '<' + tag + '>' + (isVoid ? '' : '</' + tag + '>');
      node = holder.firstChild;
      holder.removeChild(node);
    } else {
      node = document.createElement(tag);
    }
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function styleName(name) {
    if (name.indexOf('--') === 0) return name;
    return name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
  }

  function setStyle(node, name, value) {
    if (!node) return;
    name = styleName(name);
    value = value == null ? '' : String(value);
    if (typeof node.setInlineStyleProperty === 'function') {
      node.setInlineStyleProperty(name, value);
    } else {
      node.style.setProperty(name, value);
    }
  }

  function on(target, type, fn, capture) {
    target.addEventListener(type, fn, capture === true);
    return fn;
  }

  function off(target, type, fn, capture) {
    target.removeEventListener(type, fn, capture === true);
  }

  function classListOf(node) {
    if (!node) return null;
    try { return node.classList || null; } catch (e) { return null; }
  }
  function addClass(node, name) {
    if (!node) return;
    var cl = classListOf(node);
    if (cl) { cl.add(name); return; }
    var cur = node.getAttribute('class') || '';
    if (cur.indexOf(name) < 0) node.setAttribute('class', (cur + ' ' + name).replace(/^\s+/, ''));
  }
  function removeClass(node, name) {
    if (!node) return;
    var cl = classListOf(node);
    if (cl) { cl.remove(name); return; }
    var cur = ' ' + (node.getAttribute('class') || '') + ' ';
    node.setAttribute('class', cur.replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, ''));
  }
  function toggleClass(node, name, force) {
    if (!node) return;
    if (force === undefined) force = !hasClass(node, name);
    if (force) addClass(node, name); else removeClass(node, name);
  }
  function hasClass(node, name) {
    if (!node) return false;
    var cl = classListOf(node);
    if (cl) return cl.contains(name);
    return (' ' + (node.getAttribute('class') || '') + ' ').indexOf(' ' + name + ' ') >= 0;
  }

  function rect(node) {
    var r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }

  function offset(node, parent) {
    var x = 0, y = 0, cur = node;
    while (cur) {
      x += cur.offsetLeft || 0;
      y += cur.offsetTop || 0;
      cur = cur.offsetParent;
      if (parent && cur === parent) break;
    }
    if (parent) {
      var pr = rect(parent);
      var nr = rect(node);
      return { x: nr.x - pr.x, y: nr.y - pr.y };
    }
    return { x: x, y: y };
  }

  function isVisible(node) {
    if (!node) return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function closest(node, selector) {
    var cur = node;
    while (cur && cur !== document) {
      if (cur.matches && cur.matches(selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function delegate(root, selector, type, fn) {
    return on(root, type, function (ev) {
      var target = closest(ev.target, selector);
      if (target && (root === target || root.contains(target))) fn(ev, target);
    });
  }

  var dom = {
    el: el,
    clear: function (node) {
      if (!node) return node;
      while (node.firstChild) node.removeChild(node.firstChild);
      return node;
    },
    on: on,
    off: off,
    addClass: addClass,
    removeClass: removeClass,
    toggleClass: toggleClass,
    hasClass: hasClass,
    text: function (node, v) { if (node) node.textContent = v; },
    html: function (node, v) { if (node) node.innerHTML = v; },
    attr: function (node, name, value) {
      if (!node) return null;
      if (value === undefined) return node.getAttribute(name);
      if (value === null || value === false) node.removeAttribute(name);
      else node.setAttribute(name, value);
      return node;
    },
    css: function (node, prop, value) {
      if (!node) return;
      if (value === undefined) {
        if (typeof node.getInlineStylePropertyValue === 'function') {
          return node.getInlineStylePropertyValue(styleName(prop));
        }
        return node.style.getPropertyValue(styleName(prop));
      }
      setStyle(node, prop, value);
    },
    setStyle: setStyle,
    sameNode: function (a, b) {
      if (a === b) return true;
      // Rhino may return different JS wrappers for the same mounted Java node.
      return !!(a && b && isAUI && typeof a.equals === 'function' && a.equals(b));
    },
    rect: rect,
    offset: offset,
    isVisible: isVisible,
    closest: closest,
    delegate: delegate,
    afterLayout: function (fn) {
      // AUI commits layout in slices; its first rAF can precede usable geometry.
      if (isAUI) global.setTimeout(fn, 100);
      else if (global.requestAnimationFrame) global.requestAnimationFrame(fn);
      else setTimeout(fn, 16);
    }
  };

  var event = {
    ctrl: function (e) { return !!(e && (e.controlKey || e.ctrlKey)); },
    shift: function (e) { return !!(e && e.shiftKey); },
    alt: function (e) { return !!(e && e.altKey); },
    meta: function (e) { return !!(e && e.metaKey); },
    key: function (e) {
      var k = e && e.key;
      if (!k || k === 'Unidentified') k = (e && e.code) || '';
      if (k === ' ' || k === 'Spacebar') k = 'Space';
      if (k === 'ArrowLeft') k = 'Left';
      if (k === 'ArrowRight') k = 'Right';
      if (k === 'ArrowUp') k = 'Up';
      if (k === 'ArrowDown') k = 'Down';
      if (k === 'Escape') k = 'Esc';
      if (k === 'Delete' || k === 'Backspace') k = k === 'Backspace' ? 'Backspace' : 'Delete';
      return k;
    },
    combo: function (e) {
      var parts = [];
      if (event.ctrl(e)) parts.push('Ctrl');
      if (event.shift(e)) parts.push('Shift');
      if (event.alt(e)) parts.push('Alt');
      if (event.meta(e)) parts.push('Meta');
      var k = event.key(e);
      if (k && k.length === 1) k = k.toUpperCase();
      parts.push(k);
      return parts.join('+');
    },
    stop: function (e) {
      if (!e) return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    },
    isTextInput: function (target) {
      if (!target) return false;
      var tag = (target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (target.isContentEditable) return true;
      return false;
    },
    pos: function (e) { return { x: e.clientX, y: e.clientY }; }
  };

  var ICONS = {
    graph: '<path d="M3 3h3v3H3z"/><path d="M10 10h3v3h-3z"/><path d="M6 4.5h2.5a1.5 1.5 0 0 1 1.5 1.5v4"/><path d="M3 6v7h5"/>',
    branch: '<circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="4" r="1.6"/><circle cx="8" cy="12" r="1.6"/><path d="M4 5.6v1.9a2 2 0 0 0 2 2h4"/><path d="M12 5.6v4.4a2 2 0 0 1-2 2H8"/>',
    montage: '<path d="M2 3v10M14 3v10"/><path d="M5 4h3v3H5zM9 8h2v4H9z"/><path d="M2 8h12"/>',
    clip: '<path d="M3 3h10v10H3z"/><path d="M3 6h10M3 10h10M6 3v10M10 3v10"/>',
    skeleton: '<circle cx="8" cy="3.4" r="1.7"/><path d="M8 5.2v4.4M8 7l-3.2 2M8 7l3.2 2M8 9.6l-2.2 3.6M8 9.6l2.2 3.6"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    minus: '<path d="M3 8h10"/>',
    save: '<path d="M3 3h7.5L13 5.5V13H3z"/><path d="M5.5 3v3.5h4V3M5.5 13V9.5h5V13"/>',
    undo: '<path d="M6 4L3 7l3 3"/><path d="M3 7h6a4 4 0 0 1 4 4v1"/>',
    redo: '<path d="M10 4l3 3-3 3"/><path d="M13 7H7a4 4 0 0 0-4 4v1"/>',
    play: '<path d="M5 3l8 5-8 5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M5 3v10M11 3v10" stroke-width="2.6"/>',
    stop: '<path d="M4 4h8v8H4z" fill="currentColor" stroke="none"/>',
    loop: '<path d="M3 8a5 5 0 0 1 5-5h2"/><path d="M8.5 5.5L10 7l1.5-1.5"/><path d="M13 8a5 5 0 0 1-5 5H6"/><path d="M7.5 10.5L6 9l-1.5 1.5"/>',
    settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"/>',
    sliders: '<path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.6" fill="#fff"/><circle cx="10" cy="11" r="1.6" fill="#fff"/>',
    search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.2 3.2"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    'chevron-right': '<path d="M6 3.5L10.5 8 6 12.5"/>',
    'chevron-left': '<path d="M10 3.5L5.5 8 10 12.5"/>',
    'chevron-down': '<path d="M3.5 6L8 10.5 12.5 6"/>',
    'chevron-up': '<path d="M3.5 10L8 5.5 12.5 10"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/><path d="M6.8 7v3.5M9.2 7v3.5"/>',
    copy: '<path d="M5 5h8v8H5z"/><path d="M3 3v8h2M11 3v2h2"/>',
    layers: '<path d="M8 2.5l5 2.5-5 2.5-5-2.5z"/><path d="M3 8l5 2.5L13 8M3 11l5 2.5L13 11"/>',
    box: '<path d="M8 2l5 2.7v6.6L8 14l-5-2.7V4.7z"/><path d="M3 4.7L8 7.4l5-2.7M8 7.4V14"/>',
    flag: '<path d="M4 2v12"/><path d="M4 3h8l-2 2.5L12 8H4"/>',
    diamond: '<path d="M8 2.8l5.2 5.2L8 13.2 2.8 8z"/>',
    curve: '<path d="M2 12c3 0 3.5-8 6-8s3 6 6 6"/>',
    fit: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
    'zoom-in': '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.2 3.2M7 5v4M5 7h4"/>',
    'zoom-out': '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.2 3.2M5 7h4"/>',
    menu: '<path d="M3 4h10M3 8h10M3 12h10"/>',
    'more-h': '<circle cx="4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
    folder: '<path d="M2.5 4.5h4l1.2 1.5H13.5v6.5h-11z"/>',
    'folder-open': '<path d="M2.5 4.5h4l1.2 1.5h5.3v2H5l-2.5 5z"/><path d="M2.5 13.5l2-5h10l-2 5z"/>',
    file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
    eye: '<path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
    'eye-off': '<path d="M2 2l12 12"/><path d="M4 4.5C2.5 6 1.5 8 1.5 8S4 12 8 12c1 0 2-.2 2.8-.6M11.8 10.4C13.4 9 14.5 8 14.5 8S12 4 8 4"/>',
    lock: '<path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2"/><path d="M3.5 7h9v6.5h-9z"/>',
    unlock: '<path d="M4.5 7V5a3.5 3.5 0 0 1 6.7-1.4"/><path d="M3.5 7h9v6.5h-9z"/>',
    warning: '<path d="M8 2.2L14 13H2z"/><path d="M8 6v3.5M8 11.3v.5"/>',
    check: '<path d="M3 8.5l3.2 3.2L13 4.5"/>',
    dot: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>',
    keyboard: '<rect x="1.8" y="4" width="12.4" height="8" rx="0"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4 9h8"/>',
    'panel-left': '<path d="M2 3h12v10H2z"/><path d="M6 3v10"/>',
    'panel-right': '<path d="M2 3h12v10H2z"/><path d="M10 3v10"/>',
    'panel-bottom': '<path d="M2 3h12v10H2z"/><path d="M2 10h12"/>',
    reset: '<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5V6h3.5"/>',
    download: '<path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10"/>',
    upload: '<path d="M8 10V2M4.5 5.5L8 2l3.5 3.5M3 13h10"/>',
    info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7v4M8 4.8v.4"/>',
    link: '<path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1"/><path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2A2.5 2.5 0 0 1 4 8.5l1-1"/>',
    code: '<path d="M5.5 3.5L2 8l3.5 4.5M10.5 3.5L14 8l-3.5 4.5"/>',
    grid: '<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z"/>',
    camera: '<path d="M2 5h3l1-1.5h4L11 5h3v8H2z"/><circle cx="8" cy="9" r="2.5"/>',
    hand: '<path d="M5.5 8V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 7.5V4.5a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H6.5a4 4 0 0 1-3.2-1.6L2.2 10a1 1 0 0 1 1.6-1.2l1.7 1.7"/>',
    target: '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
    more: '<path d="M3 8h.01M8 8h.01M13 8h.01" stroke-width="2.4"/>',
    edit: '<path d="M3 13l1-3.5L10.5 3 13 5.5 6.5 12z"/><path d="M9 4.5L11.5 7"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/>',
    sparkle: '<path d="M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z"/>',
    wave: '<path d="M2 9c1.5 0 1.5-4 3-4s1.5 6 3 6 1.5-5 3-5 1.5 3 3 3"/>',
    pin: '<path d="M8 14s4.5-5 4.5-8A4.5 4.5 0 0 0 3.5 6c0 3 4.5 8 4.5 8z"/><circle cx="8" cy="6" r="1.5"/>',
    'arrow-right': '<path d="M3 8h10M9 4l4 4-4 4"/>',
    users: '<circle cx="6" cy="5" r="2.2"/><path d="M2.5 13c0-2.3 1.6-3.8 3.5-3.8S9.5 10.7 9.5 13"/><path d="M10 4.2a2 2 0 0 1 0 3.6M11 9.6c1.4.3 2.5 1.6 2.5 3.4"/>'
  };

  function renderIcon(name, size) {
    var svg = isAUI ? el('svg') :
      (document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('svg'));
    var s = size || 14;
    if (svg.setAttribute) {
      svg.setAttribute('class', 'oz-ico oz-ico-' + name);
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', String(s));
      svg.setAttribute('height', String(s));
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.4');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
    }
    var paths = ICONS[name];
    if (paths) {
      try { svg.innerHTML = paths; } catch (e) {
        // AUI fallback: plain span with a glyph-ish dot.
        var span = el('span', 'oz-ico-fallback');
        return span;
      }
    }
    return svg;
  }

  var storage = {
    get: function (key, fallback) {
      try {
        var raw = global.localStorage ? global.localStorage.getItem(key) : null;
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try {
        if (!global.localStorage) return false;
        global.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) { return false; }
    },
    remove: function (key) {
      try { if (global.localStorage) global.localStorage.removeItem(key); } catch (e) {}
    }
  };

  var listeners = {};
  var bus = {
    on: function (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return fn;
    },
    off: function (name, fn) {
      var list = listeners[name] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: function (name, payload) {
      var list = (listeners[name] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i](payload); } catch (e) {
          if (global.console) global.console.error('[PoseForge] listener error ' + name, e);
        }
      }
    }
  };

  OZ.util = util;
  OZ.dom = dom;
  OZ.event = event;
  OZ.Icons = { render: renderIcon, list: function () { return Object.keys(ICONS); } };
  OZ.icon = renderIcon;
  OZ.storage = storage;
  OZ.bus = bus;
})(typeof window !== 'undefined' ? window : this, OZ);
