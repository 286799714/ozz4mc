/* Per-document undo/redo stacks (snapshot based). ES5. */
(function (global, OZ) {
  'use strict';

  function create() {
    return {
      undo: [],
      redo: [],
      limit: 80,
      record: function (doc, label, before) {
        doc.undo.push({ label: label, data: before });
        if (doc.undo.length > this.limit) doc.undo.shift();
        doc.redo.length = 0;
      },
      undoDoc: function (doc) {
        if (!doc.undo.length) return null;
        var entry = doc.undo.pop();
        doc.redo.push(entry);
        return entry;
      },
      redoDoc: function (doc) {
        if (!doc.redo.length) return null;
        var entry = doc.redo.pop();
        doc.undo.push(entry);
        return entry;
      },
      canUndo: function (doc) { return !!(doc && doc.undo && doc.undo.length); },
      canRedo: function (doc) { return !!(doc && doc.redo && doc.redo.length); },
      clear: function (doc) { if (doc) { doc.undo.length = 0; doc.redo.length = 0; } }
    };
  }

  OZ.History = { create: create };
})(OZ.host, OZ);
