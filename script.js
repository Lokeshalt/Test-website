/* ============================================================
   Study Mantra Library — script.js
   ============================================================ */


/* ── OCCUPANCY CONFIG ────────────────────────────────────────
   Update these values whenever you do a manual headcount.
   Everything else (grid, stats, bars) recalculates automatically.
   ──────────────────────────────────────────────────────────── */
var OCC = {
  total:    67,
  occupied: 17,   // ← number of seats currently occupied
  reserved: 4,    // ← number of seats held/booked
  date:     "16 March 2026",  // ← date of last update
  morning:  12,   // ← morning slot occupancy %  (6 AM – 2 PM)
  evening:  5    // ← evening slot occupancy %  (2 PM – 11 PM)
};
/* ──────────────────────────────────────────────────────────── */


/* ── OCCUPANCY RENDERER ─────────────────────────────────────
   Reads OCC config above and populates the occupancy section.
   ──────────────────────────────────────────────────────────── */
function renderOccupancy() {
  var o     = OCC;
  var avail = o.total - o.occupied - o.reserved;
  var pct   = Math.round((o.occupied / o.total) * 100);

  // Date label
  document.getElementById('occ-date').textContent = 'Updated on: ' + o.date;

  // Stat cards
  document.getElementById('occ-avail').textContent     = avail;
  document.getElementById('occ-avail-sub').textContent = 'of ' + o.total + ' total seats';
  document.getElementById('occ-pct').textContent       = pct + '%';
  document.getElementById('occ-taken-sub').textContent = o.occupied + ' seats taken';
  document.getElementById('occ-bar').style.width       = pct + '%';

  // Slot bars
  document.getElementById('occ-morning-pct').textContent = o.morning + '%';
  document.getElementById('occ-morning-bar').style.width = o.morning + '%';
  document.getElementById('occ-evening-pct').textContent = o.evening + '%';
  document.getElementById('occ-evening-bar').style.width = o.evening + '%';

  // Build seat grid
  var grid = document.getElementById('seatGrid');
  for (var i = 0; i < o.total; i++) {
    var s = document.createElement('div');
    s.className = 'seat' +
      (i < o.occupied              ? ' occupied' :
       i < o.occupied + o.reserved ? ' reserved' : '');
    grid.appendChild(s);
  }
}


/* ── PLAN PRE-SELECTION ─────────────────────────────────────
   Called by "Get Started" buttons on the plans section.
   Sets the matching option in the enquiry form dropdown.
   index: 0 = Morning, 1 = Evening, 2 = Full Day
   ──────────────────────────────────────────────────────────── */
function selectPlan(index) {
  var dropdown = document.getElementById('f-plan');
  if (dropdown) dropdown.selectedIndex = index;
}


/* ── WHATSAPP ENQUIRY ────────────────────────────────────────
   Reads the enquiry form, builds a formatted WhatsApp message,
   and opens wa.me with the message pre-filled.
   ──────────────────────────────────────────────────────────── */
function sendWhatsApp() {
  var name  = document.getElementById('f-name').value.trim();
  var phone = document.getElementById('f-phone').value.trim();
  var plan  = document.getElementById('f-plan').value;
  var exam  = document.getElementById('f-exam').value;
  var msg   = document.getElementById('f-msg').value.trim();

  if (!name) { alert('Please enter your name.'); return; }

  var text = '*Study Mantra Library \u2013 New Enquiry*\n\n';
  text += '*Name:* ' + name + '\n';
  if (phone) text += '*Phone:* ' + phone + '\n';
  text += '*Plan:* ' + plan + '\n';
  text += '*Exam / Purpose:* ' + exam + '\n';
  if (msg)   text += '*Message:* ' + msg + '\n';

  var WA_NUMBER = '918949701991';
  var url = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}


/* ── INIT ────────────────────────────────────────────────────
   Run on page load.
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  renderOccupancy();
});
