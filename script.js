'use strict';

// ── State ──────────────────────────────────────────
const state = {
  current:      '0',
  expression:   '',
  operand:      null,
  operator:     null,
  waitingForRHS: false,
  justEvaled:    false,
};

// ── DOM refs ───────────────────────────────────────
const displayVal  = document.getElementById('current-value');
const displayExpr = document.getElementById('expression');
const modalOverlay  = document.getElementById('modal-overlay');
const btnMaybe      = document.getElementById('btn-maybe');
const qrScreen      = document.getElementById('qr-screen');
const qrPlanName    = document.getElementById('qr-plan-name');
const qrSvgContainer = document.getElementById('qr-svg-container');
const qrStatus      = document.getElementById('qr-status');
const btnPaid       = document.getElementById('btn-paid');
const btnQrCancel   = document.getElementById('btn-qr-cancel');

// ── Display update ─────────────────────────────────
function render() {
  displayVal.textContent  = state.current;
  displayExpr.textContent = state.expression || ' ';
  displayVal.classList.toggle('has-op', state.waitingForRHS);

  document.querySelectorAll('.btn-op').forEach(btn => {
    const active = state.operator && btn.dataset.value === state.operator && state.waitingForRHS;
    btn.classList.toggle('active-op', !!active);
  });
}

// ── Safe evaluate ──────────────────────────────────
function applyOperator(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? 'Error' : a / b;
  }
}

function formatResult(n) {
  if (n === 'Error') return 'Error';
  if (!isFinite(n))  return 'Error';
  // Avoid floating-point noise
  const s = parseFloat(n.toPrecision(12)).toString();
  return s;
}

// ── Actions ────────────────────────────────────────
const actions = {
  digit(v) {
    if (state.justEvaled) {
      state.expression = '';
      state.justEvaled = false;
    }
    if (state.waitingForRHS) {
      state.current      = v;
      state.waitingForRHS = false;
    } else {
      state.current = state.current === '0' ? v : state.current + v;
    }
  },

  decimal() {
    if (state.justEvaled) {
      state.current      = '0.';
      state.expression   = '';
      state.justEvaled   = false;
      return;
    }
    if (state.waitingForRHS) {
      state.current      = '0.';
      state.waitingForRHS = false;
      return;
    }
    if (!state.current.includes('.')) state.current += '.';
  },

  operator(op) {
    state.justEvaled = false;
    const cur = parseFloat(state.current);

    if (state.operator && !state.waitingForRHS) {
      const result = applyOperator(state.operand, state.operator, cur);
      state.current   = formatResult(result);
      state.operand   = typeof result === 'number' ? result : NaN;
    } else {
      state.operand = isNaN(cur) ? 0 : cur;
    }

    state.operator      = op;
    state.waitingForRHS  = true;
    const opSymbol = { '+':'+', '-':'−', '*':'×', '/':'÷' }[op];
    state.expression = state.current + ' ' + opSymbol;
  },

  equals() {
    if (!state.operator) return;
    const lhs = state.operand;
    const rhs = parseFloat(state.current);
    const result = applyOperator(lhs, state.operator, rhs);

    const opSymbol = { '+':'+', '-':'−', '*':'×', '/':'÷' }[state.operator];
    const fullExpr = `${lhs} ${opSymbol} ${rhs} =`;

    // Store pending result; show modal first
    pendingResult = { value: formatResult(result), expression: fullExpr };
    showModal();
  },

  clear() {
    Object.assign(state, {
      current: '0', expression: '', operand: null,
      operator: null, waitingForRHS: false, justEvaled: false,
    });
  },

  sign() {
    const n = parseFloat(state.current);
    if (!isNaN(n) && n !== 0) state.current = formatResult(-n);
  },

  percent() {
    const n = parseFloat(state.current);
    if (!isNaN(n)) state.current = formatResult(n / 100);
  },

  backspace() {
    if (state.justEvaled || state.current === 'Error') {
      state.current = '0';
      state.justEvaled = false;
      return;
    }
    state.current = state.current.length > 1
      ? state.current.slice(0, -1)
      : '0';
  },
};

// ── Button click handler ───────────────────────────
document.querySelector('.btn-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, value } = btn.dataset;
  if (actions[action]) {
    actions[action](value);
    render();
  }
});

// ── Keyboard support ───────────────────────────────
document.addEventListener('keydown', e => {
  if (modalOverlay && !modalOverlay.hidden) {
    if (e.key === 'Escape') closeMaybeShow();
    return;
  }

  const key = e.key;
  if (key >= '0' && key <= '9')        { actions.digit(key);            }
  else if (key === '.')                 { actions.decimal();             }
  else if (key === '+')                 { actions.operator('+');         }
  else if (key === '-')                 { actions.operator('-');         }
  else if (key === '*')                 { actions.operator('*');         }
  else if (key === '/')                 { e.preventDefault(); actions.operator('/'); }
  else if (key === 'Enter' || key === '=') { actions.equals();          }
  else if (key === 'Backspace')         { actions.backspace();           }
  else if (key === 'Escape')            { actions.clear();               }
  else if (key === '%')                 { actions.percent();             }
  else return;

  render();
});

// ── Fake QR code generator ─────────────────────────
function generateQRSVG(url) {
  const N = 25;
  const cell = 8;
  const sz = N * cell;

  // Mark reserved zones (finder patterns + separators)
  const reserved = new Set();
  function markZone(r, c, h, w) {
    for (let dr = 0; dr < h; dr++)
      for (let dc = 0; dc < w; dc++)
        reserved.add(`${r + dr},${c + dc}`);
  }
  markZone(0, 0, 8, 8);          // top-left finder + separator
  markZone(0, N - 8, 8, 8);      // top-right finder + separator
  markZone(N - 8, 0, 8, 8);      // bottom-left finder + separator
  markZone(6, 0, 1, N);          // horizontal timing
  markZone(0, 6, N, 1);          // vertical timing

  // Deterministic hash → repeatable "random" pattern
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  function next() { h = (h * 1664525 + 1013904223) >>> 0; return h / 0x100000000; }

  let rects = '';

  // Finder pattern (7×7): solid outer ring, white ring, solid 3×3 core
  function drawFinder(row, col) {
    const x = col * cell, y = row * cell;
    rects += `<rect x="${x}" y="${y}" width="${7*cell}" height="${7*cell}" fill="#000"/>`;
    rects += `<rect x="${x+cell}" y="${y+cell}" width="${5*cell}" height="${5*cell}" fill="#fff"/>`;
    rects += `<rect x="${x+2*cell}" y="${y+2*cell}" width="${3*cell}" height="${3*cell}" fill="#000"/>`;
  }
  drawFinder(0, 0);
  drawFinder(0, N - 7);
  drawFinder(N - 7, 0);

  // Timing strips
  for (let i = 8; i < N - 8; i++) {
    if (i % 2 === 0) {
      rects += `<rect x="${i*cell}" y="${6*cell}" width="${cell}" height="${cell}" fill="#000"/>`;
      rects += `<rect x="${6*cell}" y="${i*cell}" width="${cell}" height="${cell}" fill="#000"/>`;
    }
  }

  // Data modules
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (reserved.has(`${r},${c}`)) continue;
      if (next() < 0.44)
        rects += `<rect x="${c*cell}" y="${r*cell}" width="${cell}" height="${cell}" fill="#000"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" shape-rendering="crispEdges">
  <rect width="${sz}" height="${sz}" fill="#fff"/>
  ${rects}
</svg>`;
}

// ── Modal logic ────────────────────────────────────
let pendingResult = null;

function showModal() {
  // Reset to plan-selection view
  qrScreen.hidden = true;
  document.querySelectorAll('.plan-card').forEach(c => { c.hidden = false; c.disabled = false; });
  btnMaybe.hidden = false;
  modalOverlay.hidden = false;
  modalOverlay.focus();
}

function closeMaybeShow() {
  modalOverlay.hidden = true;
  qrScreen.hidden = true;
  if (pendingResult) {
    state.current      = pendingResult.value;
    state.expression   = pendingResult.expression;
    state.operand      = null;
    state.operator     = null;
    state.waitingForRHS = false;
    state.justEvaled   = true;
    pendingResult      = null;
    render();
  }
}

function showQRScreen(planName) {
  // Hide plan list, show QR screen
  document.querySelectorAll('.plan-card').forEach(c => { c.hidden = true; });
  btnMaybe.hidden = true;

  qrPlanName.textContent = planName;
  qrSvgContainer.innerHTML = generateQRSVG('https://www.linkedin.com/company/finzco/');
  qrStatus.hidden = true;
  btnPaid.disabled = false;
  qrScreen.hidden = false;
}

// "Maybe later"
btnMaybe.addEventListener('click', closeMaybeShow);

// Upgrade plan buttons → show QR screen
document.querySelectorAll('.plan-card').forEach(btn => {
  btn.addEventListener('click', () => showQRScreen(btn.dataset.plan));
});

// "I have paid"
btnPaid.addEventListener('click', () => {
  btnPaid.disabled = true;
  btnQrCancel.disabled = true;
  qrStatus.hidden = false;
  setTimeout(() => {
    btnQrCancel.disabled = false;
    closeMaybeShow();
  }, 1000);
});

// "Cancel" → back to plan selection
btnQrCancel.addEventListener('click', showModal);

// Click outside modal to dismiss
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeMaybeShow();
});

// ── Init ───────────────────────────────────────────
render();
