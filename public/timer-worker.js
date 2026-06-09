// timer-worker.js — tick isolado em Web Worker
// Não é afetado pela throttling de timers que o navegador aplica em abas ocultas.
// A página envia { cmd: 'start', interval: N, gen: G } para iniciar um countdown de N segundos.
// O worker ecoa o gen em cada resposta para que a página descarte ticks de ciclos anteriores.

var interval  = 60;
var remaining = 0;
var timer     = null;
var currentGen = 0;

self.onmessage = function(e) {
  var cmd = e.data.cmd;
  if (cmd === 'start') {
    interval   = e.data.interval || 60;
    remaining  = interval;
    currentGen = e.data.gen || 0;
    if (timer) clearInterval(timer);
    timer = setInterval(function() {
      remaining--;
      self.postMessage({ type: 'tick', remaining: remaining, gen: currentGen });
      if (remaining <= 0) {
        clearInterval(timer);
        timer = null;
        self.postMessage({ type: 'done', gen: currentGen });
      }
    }, 1000);
  } else if (cmd === 'stop') {
    if (timer) { clearInterval(timer); timer = null; }
  }
};
