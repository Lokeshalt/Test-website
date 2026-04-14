/* ============================================================
   Study Mantra Library — script.js
   ============================================================ */


/* ── OCCUPANCY CONFIG ────────────────────────────────────────
   Keep the fallback values below for times when both the
   snapshot file and live refresh are unavailable. The page now
   loads occupancy.json first and uses OCC_CSV_URL only for the
   manual refresh button.
   ──────────────────────────────────────────────────────────── */
var OCC = {
  total:             67,
  halfDay:           3,   // ← number of Half-day seats
  fullDayReserved:   35,  // ← number of Full-day (reserved) seats
  date:              "18 March 2026 (fallback)",  // ← last known update
  seatStatuses:      null
};
var OCC_SNAPSHOT_URL = 'occupancy.json';
var OCC_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvw5mFJQ-esd6lSpevUKdpzphem3oD5mcVnNbds9TjPRSu929Q8t1eCz7uuoTVeI8FLKTcFSpAeJWY/pub?output=csv';
var OCC_REFRESH_BUTTON_LABEL = 'Refresh Now';
var occRefreshInFlight = false;
/* ──────────────────────────────────────────────────────────── */


/* ── OCCUPANCY RENDERER ─────────────────────────────────────
   Reads OCC config above and populates the occupancy section.
   ──────────────────────────────────────────────────────────── */
function formatOccupancyTimestamp(date) {
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function normalizeOccupancyHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeOccupancyStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function classifyOccupancyStatus(value) {
  var normalized = normalizeOccupancyStatus(value);
  if (!normalized || normalized === 'available') {
    return 'available';
  }
  if (normalized.indexOf('half') !== -1 && normalized.indexOf('day') !== -1) {
    return 'halfDay';
  }
  if (normalized.indexOf('full') !== -1 && normalized.indexOf('day') !== -1) {
    return 'fullDayReserved';
  }
  return '';
}

function createSeatStatusMap(totalSeats) {
  var seatStatuses = {};

  for (var seat = 1; seat <= totalSeats; seat++) {
    seatStatuses[seat] = 'available';
  }

  return seatStatuses;
}

function buildFallbackSeatStatuses(totalSeats, halfDayCount, fullDayReservedCount) {
  var seatStatuses = createSeatStatusMap(totalSeats);

  for (var seat = 1; seat <= totalSeats; seat++) {
    if (seat <= halfDayCount) {
      seatStatuses[seat] = 'halfDay';
    } else if (seat <= halfDayCount + fullDayReservedCount) {
      seatStatuses[seat] = 'fullDayReserved';
    }
  }

  return seatStatuses;
}

function countSeatStatuses(seatStatuses, totalSeats) {
  var counts = {
    halfDay: 0,
    fullDayReserved: 0
  };

  for (var seat = 1; seat <= totalSeats; seat++) {
    if (seatStatuses[seat] === 'halfDay') {
      counts.halfDay++;
    } else if (seatStatuses[seat] === 'fullDayReserved') {
      counts.fullDayReserved++;
    }
  }

  return counts;
}

function normalizeOccupancyEntries(entries, totalSeats) {
  if (!Array.isArray(entries)) {
    throw new Error('Seat data must be an array.');
  }

  var seatStatuses = createSeatStatusMap(totalSeats);
  var validRows = 0;

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    var seatNumber = parseInt(String(entry.seat || '').trim(), 10);
    if (isNaN(seatNumber) || seatNumber < 1 || seatNumber > totalSeats) {
      continue;
    }

    var statusType = classifyOccupancyStatus(entry.status);
    if (!statusType) {
      continue;
    }

    seatStatuses[seatNumber] = statusType;
    validRows++;
  }

  if (!validRows) {
    throw new Error('No valid seat rows were found.');
  }

  return {
    seatStatuses: seatStatuses,
    counts: countSeatStatuses(seatStatuses, totalSeats)
  };
}

function applyOccupancyState(seatStatuses, dateLabel) {
  var counts = countSeatStatuses(seatStatuses, OCC.total);
  OCC.seatStatuses = seatStatuses;
  OCC.halfDay = counts.halfDay;
  OCC.fullDayReserved = counts.fullDayReserved;
  OCC.date = dateLabel || OCC.date;
}

function parseCsv(text) {
  var rows = [];
  var row = [];
  var value = '';
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var char = text.charAt(i);
    var next = text.charAt(i + 1);

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i++;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter(function (currentRow) {
    return currentRow.some(function (cell) {
      return String(cell || '').trim() !== '';
    });
  });
}

function getOccupancyColumnIndex(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var index = headers.indexOf(candidates[i]);
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function extractOccupancyEntriesFromCsv(csvText) {
  var rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error('The occupancy CSV is empty.');
  }

  var headers = rows[0].map(normalizeOccupancyHeader);
  var seatIndex = getOccupancyColumnIndex(headers, ['seat', 'seats', 'seatnumber', 'seatno']);
  var statusIndex = getOccupancyColumnIndex(headers, ['status', 'seatstatus', 'occupancystatus']);

  if (seatIndex === -1) {
    throw new Error('The occupancy CSV must include a Seat column.');
  }

  if (statusIndex === -1) {
    throw new Error('The occupancy CSV must include a Status column.');
  }

  var entries = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row.length) {
      continue;
    }

    var rawSeat = row[seatIndex];
    var rawStatus = row[statusIndex];

    if (!String(rawSeat || '').trim() && !String(rawStatus || '').trim()) {
      continue;
    }

    entries.push({
      seat: rawSeat,
      status: rawStatus
    });
  }

  if (!entries.length) {
    throw new Error('The occupancy CSV does not contain any seat rows.');
  }

  return entries;
}

function buildOccupancyRequestUrl(baseUrl) {
  var joiner = baseUrl.indexOf('?') === -1 ? '?' : '&';
  return baseUrl + joiner + 'ts=' + Date.now();
}

function setOccupancyRefreshUi(state, message) {
  var button = document.getElementById('occ-refresh-btn');
  var status = document.getElementById('occ-refresh-status');
  var refreshAvailable = !!(OCC_CSV_URL && window.fetch);

  if (button) {
    button.disabled = !refreshAvailable || state === 'loading';
    button.textContent = state === 'loading' ? 'Refreshing...' : OCC_REFRESH_BUTTON_LABEL;
    button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
    button.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }

  if (status) {
    if (!refreshAvailable) {
      status.textContent = 'Live refresh is unavailable.';
      return;
    }
    status.textContent = message || '';
  }
}

function fetchOccupancyData(triggerSource) {
  var source = triggerSource || 'auto';

  if (!OCC_CSV_URL || !window.fetch) {
    renderOccupancy();
    setOccupancyRefreshUi('idle');
    return;
  }

  if (occRefreshInFlight) {
    if (source === 'manual') {
      setOccupancyRefreshUi('loading', 'A refresh is already in progress.');
    }
    return;
  }

  occRefreshInFlight = true;
  setOccupancyRefreshUi('loading', 'Checking the latest sheet data...');

  fetch(buildOccupancyRequestUrl(OCC_CSV_URL), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status + '.');
      }
      return response.text();
    })
    .then(function (csvText) {
      var entries = extractOccupancyEntriesFromCsv(csvText);
      var normalized = normalizeOccupancyEntries(entries, OCC.total);
      applyOccupancyState(normalized.seatStatuses, formatOccupancyTimestamp(new Date()));
      renderOccupancy();
      occRefreshInFlight = false;
      if (source === 'manual') {
        setOccupancyRefreshUi('idle', 'Seat data refreshed just now.');
      } else {
        setOccupancyRefreshUi('idle');
      }
    })
    .catch(function (error) {
      console.error('Unable to refresh occupancy data.', error);
      renderOccupancy();
      occRefreshInFlight = false;
      if (source === 'manual') {
        setOccupancyRefreshUi('idle', 'Refresh failed. Showing the last available data.');
      } else {
        setOccupancyRefreshUi('idle', 'Showing the last available data.');
      }
    });
}

function fetchOccupancySnapshot() {
  if (!window.fetch) {
    renderOccupancy();
    return;
  }

  fetch(buildOccupancyRequestUrl(OCC_SNAPSHOT_URL), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status + '.');
      }
      return response.json();
    })
    .then(function (snapshot) {
      if (!snapshot || !Array.isArray(snapshot.seats)) {
        throw new Error('The occupancy snapshot is invalid.');
      }

      var normalized = normalizeOccupancyEntries(snapshot.seats, OCC.total);
      var snapshotDate = OCC.date;

      if (snapshot.updatedAt) {
        var updatedAt = new Date(snapshot.updatedAt);
        if (!isNaN(updatedAt.getTime())) {
          snapshotDate = formatOccupancyTimestamp(updatedAt);
        }
      }

      applyOccupancyState(normalized.seatStatuses, snapshotDate);
      renderOccupancy();
    })
    .catch(function (error) {
      console.error('Unable to load occupancy snapshot.', error);
      renderOccupancy();
      setOccupancyRefreshUi('idle', 'Showing the last available data.');
    });
}

function renderOccupancy() {
  var o      = OCC;
  var seatStatuses = o.seatStatuses || buildFallbackSeatStatuses(o.total, o.halfDay, o.fullDayReserved);
  var counts = countSeatStatuses(seatStatuses, o.total);
  var taken  = counts.halfDay + counts.fullDayReserved;
  var avail  = o.total - taken;
  var pct    = Math.round(taken / o.total * 100);

  // Date label
  document.getElementById('occ-date').textContent = 'Updated on: ' + o.date;

  // Stat cards
  document.getElementById('occ-avail').textContent     = avail;
  document.getElementById('occ-avail-sub').textContent = 'of ' + o.total + ' total seats';
  document.getElementById('occ-pct').textContent       = pct + '%';
  document.getElementById('occ-taken-sub').textContent = taken + ' seats occupied';
  document.getElementById('occ-bar').style.width       = pct + '%';

  // Plan type bars
  var halfDayPct = Math.round((counts.halfDay / o.total) * 100);
  var fullDayPct = Math.round((counts.fullDayReserved / o.total) * 100);
  document.getElementById('occ-half-day-pct').textContent = halfDayPct + '%';
  document.getElementById('occ-half-day-bar').style.width = halfDayPct + '%';
  document.getElementById('occ-full-day-pct').textContent = fullDayPct + '%';
  document.getElementById('occ-full-day-bar').style.width = fullDayPct + '%';

  // Build seat grid
  var grid = document.getElementById('seatGrid');
  grid.innerHTML = '';
  for (var i = 1; i <= o.total; i++) {
    var s = document.createElement('div');
    var seatStatus = seatStatuses[i] || 'available';

    s.className = 'seat' +
      (seatStatus === 'halfDay' ? ' half-day' :
       seatStatus === 'fullDayReserved' ? ' full-day-reserved' : '');
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

  var WA_NUMBER = '+918949701991';
  var url = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}


/* Gallery lightbox
   Initializes only on pages that include the gallery viewer markup. */
function initGalleryLightbox() {
  var lightbox = document.getElementById('gallery-lightbox');
  if (!lightbox) return;

  var galleryItems = Array.from(document.querySelectorAll('.masonry-item:not(.placeholder)'));
  if (!galleryItems.length) return;

  var lightboxImage = lightbox.querySelector('.lightbox-image');
  var lightboxCaption = lightbox.querySelector('.lightbox-caption');
  var closeButton = lightbox.querySelector('.lightbox-close');
  var prevButton = lightbox.querySelector('.lightbox-prev');
  var nextButton = lightbox.querySelector('.lightbox-next');
  var activeIndex = 0;

  function renderLightbox(index) {
    var item = galleryItems[index];
    var image = item.querySelector('img');
    var caption = item.querySelector('.photo-caption');

    activeIndex = index;
    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    lightboxCaption.textContent = caption ? caption.textContent : image.alt;
  }

  function openLightbox(index) {
    renderLightbox(index);
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
  }

  function closeLightbox() {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
  }

  function showNext(step) {
    var nextIndex = (activeIndex + step + galleryItems.length) % galleryItems.length;
    renderLightbox(nextIndex);
  }

  galleryItems.forEach(function (item, index) {
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', 'Open photo viewer');

    item.addEventListener('click', function () {
      openLightbox(index);
    });

    item.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(index);
      }
    });
  });

  closeButton.addEventListener('click', closeLightbox);
  prevButton.addEventListener('click', function () {
    showNext(-1);
  });
  nextButton.addEventListener('click', function () {
    showNext(1);
  });

  lightbox.addEventListener('click', function (event) {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (!lightbox.classList.contains('is-open')) {
      return;
    }

    if (event.key === 'Escape') {
      closeLightbox();
    } else if (event.key === 'ArrowLeft') {
      showNext(-1);
    } else if (event.key === 'ArrowRight') {
      showNext(1);
    }
  });
}


/* ── INIT ────────────────────────────────────────────────────
   Run on page load.
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('seatGrid')) {
    var refreshButton = document.getElementById('occ-refresh-btn');
    setOccupancyRefreshUi('idle');
    if (refreshButton) {
      refreshButton.addEventListener('click', function () {
        fetchOccupancyData('manual');
      });
    }
    fetchOccupancySnapshot();
  }
  initGalleryLightbox();
});
