/* ============================================================
   LUCIDE ICONS — pengganti emoji
   ------------------------------------------------------------
   Sebelumnya semua "icon" di app ini pakai karakter emoji
   (⛔ ✅ 🗑 dst) yang ditulis langsung di dalam string JS
   (toast, innerHTML, textContent). Supaya bisa diganti ke
   Lucide TANPA menyentuh ribuan baris string yang sudah ada
   (dan tanpa risiko merusak syntax karena konflik tanda kutip),
   modul ini jalan di level DOM: dia scan semua text node yang
   sudah ter-render, lalu tukar tiap karakter emoji yang dikenal
   jadi <i data-lucide="..."> yang di-render Lucide jadi SVG.

   Otomatis jalan ulang tiap ada perubahan DOM (lewat
   MutationObserver) jadi mencakup konten yang di-render lewat
   innerHTML, textContent (toast, tombol modal), maupun render
   ulang section.
   ============================================================ */

const EMOJI_ICON_MAP = {
  '⛔':'ban', '✅':'check-circle-2', '🗑':'trash-2', '⚠':'alert-triangle', '→':'arrow-right',
  '✓':'check', '✏':'pencil', '✎':'pencil-line', '➕':'plus', '↩':'undo-2',
  '🔒':'lock', '⬇':'arrow-down', '📦':'package', '👤':'user', '⚡':'zap',
  '✕':'x', '📌':'pin', '↺':'rotate-ccw', '📋':'clipboard-list', '⬆':'arrow-up',
  '🔑':'key', '🖨':'printer', '🔍':'search', '📅':'calendar', '🎯':'target',
  '💰':'wallet', '🎁':'gift', '❌':'x-circle', '💾':'save', '📝':'file-text',
  '👥':'users', '⚙':'settings', '↓':'arrow-down', '🛍':'shopping-bag', '🛒':'shopping-cart',
  '🛠':'wrench', '🏃':'footprints', '📨':'mail', '🗓':'calendar-days', '📂':'folder-open',
  '🎉':'party-popper', '🔓':'lock-open', '🔄':'refresh-cw', '📥':'inbox', '🔗':'link',
  '📈':'trending-up', '📉':'trending-down', '🚨':'siren', '↕':'move-vertical', '↑':'arrow-up',
  '💸':'banknote', '🏆':'trophy', '🤖':'bot', '👁':'eye', '🔔':'bell',
  '🧾':'receipt', '📶':'signal', '📖':'book-open', '📚':'library', '☰':'menu',
  '📡':'radio', '📤':'send', '🕐':'clock', '❔':'help-circle', '😅':'smile',
  '🚀':'rocket', '🧭':'compass', '📊':'bar-chart-3', '❤':'heart', '💼':'briefcase',
  '🚩':'flag', '🌐':'globe', '🗒':'sticky-note', '📄':'file', '👛':'shopping-bag',
  '💡':'lightbulb', '💬':'message-circle', '🏬':'store',
  'ℹ':'info', '⏰':'alarm-clock', '⏳':'hourglass', '▲':'chevron-up', '▼':'chevron-down'
};

const EMOJI_REGEX = new RegExp(
  '[' + Object.keys(EMOJI_ICON_MAP).map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + ']',
  'gu'
);

function iconifyRoot(root){
  if(!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      if(!node.nodeValue) return NodeFilter.FILTER_REJECT;
      EMOJI_REGEX.lastIndex = 0;
      if(!EMOJI_REGEX.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      const parentTag = node.parentElement ? node.parentElement.closest('script, style, i[data-lucide]') : null;
      if(parentTag) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const targets = [];
  let n;
  while((n = walker.nextNode())) targets.push(n);

  targets.forEach(node=>{
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    EMOJI_REGEX.lastIndex = 0;
    let m;
    while((m = EMOJI_REGEX.exec(text))){
      if(m.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', EMOJI_ICON_MAP[m[0]]);
      icon.className = 'inline-icon';
      frag.appendChild(icon);
      lastIndex = m.index + m[0].length;
    }
    if(lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    if(node.parentNode) node.parentNode.replaceChild(frag, node);
  });

  if(window.lucide) lucide.createIcons();
}

let iconifyScheduled = false;
function scheduleIconify(root){
  if(iconifyScheduled) return;
  iconifyScheduled = true;
  requestAnimationFrame(()=>{
    iconifyScheduled = false;
    iconifyRoot(root || document.body);
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  iconifyRoot(document.body);

  const observer = new MutationObserver((mutations)=>{
    for(const mut of mutations){
      if(mut.type === 'childList' && mut.addedNodes.length){ scheduleIconify(); return; }
      if(mut.type === 'characterData'){ scheduleIconify(); return; }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
});
