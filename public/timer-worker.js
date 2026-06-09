// timer-worker.js — tick isolado em Web Worker
// Não é afetado pela throttling de timers que o navegador aplica em abas ocultas.
// A página envia { cmd: 'start', interval: N } para iniciar um countdown de N segundos.
// O worker responde { type: 'tick', remaining: N } a cada segundo
// e { type: 'done' } quando chega a zero.

var interval = 60;
var remaining = 0;
var timer = null;

self.onmessage = function(e) {
  var cmd = e.data.cmd;
  if (cmd === 'start') {
    interval  = e.data.interval || 60;
    remaining = interval;
    if (timer) clearInterval(timer);
    timer = setInterval(function() {
      remaining--;
      self.postMessage({ type: 'tick', remaining: remaining });
      if (remaining <= 0) {
        clearInterval(timer);
        timer = null;
        self.postMessage({ type: 'done' });
      }
    }, 1000);
  } else if (cmd === 'stop') {
    if (timer) { clearInterval(timer); timer = null; }
  }
};
