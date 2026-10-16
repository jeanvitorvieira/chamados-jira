var CHECK_MS = 1000;
var timer = null;
var currentGen = 0;
var endAt = 0;

function agendarChecagem() {
  var restante = endAt - Date.now();
  timer = setTimeout(checar, Math.max(0, Math.min(CHECK_MS, restante)));
}

function checar() {
  timer = null;
  if (Date.now() >= endAt) {
    self.postMessage({ type: 'done', gen: currentGen });
    return;
  }
  agendarChecagem();
}

self.onmessage = function (e) {
  var cmd = e.data.cmd;
  if (cmd === 'start') {
    currentGen = e.data.gen || 0;
    endAt = e.data.endAt || (Date.now() + (e.data.interval || 60) * 1000);
    if (timer) clearTimeout(timer);
    agendarChecagem();
  } else if (cmd === 'stop') {
    if (timer) { clearTimeout(timer); timer = null; }
  }
};