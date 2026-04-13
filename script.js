/* ============================================================
   Study Mantra Library — script.js
   ============================================================ */


/* ── OCCUPANCY CONFIG ────────────────────────────────────────
   Keep the fallback values below for times when the sheet is
   unavailable. To enable auto-refresh, paste the public Google
   Sheets CSV URL into OCC_CSV_URL.
   ──────────────────────────────────────────────────────────── */
var OCC = {
  total:             67,
  halfDay:           3,   // ← number of Half-day seats
  fullDayReserved:   35,  // ← number of Full-day (reserved) seats
  date:              "18 March 2026 (fallback)"  // ← last known update
};
var OCC_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvw5mFJQ-esd6lSpevUKdpzphem3oD5mcVnNbds9TjPRSu929Q8t1eCz7uuoTVeI8FLKTcFSpAeJWY/pub?output=csv';
var OCC_POLL_INTERVAL_MS = 30 * 60 * 1000;
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

function summarizeOccupancyCsv(csvText, totalSeats) {
  var rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error('The occupancy CSV is empty.');
  }

  var headers = rows[0].map(normalizeOccupancyHeader);
  var seatIndex = getOccupancyColumnIndex(headers, ['seat', 'seats', 'seatnumber', 'seatno']);
  var statusIndex = getOccupancyColumnIndex(headers, ['status', 'seatstatus', 'occupancystatus']);

  if (statusIndex === -1) {
    throw new Error('The occupancy CSV must include a Status column.');
  }

  var counts = {
    halfDay: 0,
    fullDayReserved: 0
  };
  var unsupportedStatuses = {};
  var seatStatuses = {};

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var rawStatus = row[statusIndex];
    var statusType = classifyOccupancyStatus(rawStatus);

    if (seatIndex !== -1) {
      var rawSeat = row[seatIndex];
      var seatNumber = parseInt(String(rawSeat || '').trim(), 10);
      if (isNaN(seatNumber) || seatNumber < 1 || seatNumber > totalSeats) {
        continue;
      }

      if (!statusType) {
        unsupportedStatuses[String(rawStatus || '').trim() || '(blank)'] = true;
        continue;
      }

      seatStatuses[seatNumber] = statusType;
      continue;
    }

    if (!String(rawStatus || '').trim()) {
      continue;
    }

    if (!statusType) {
      unsupportedStatuses[String(rawStatus || '').trim() || '(blank)'] = true;
      continue;
    }

    if (statusType === 'halfDay') {
      counts.halfDay++;
    } else if (statusType === 'fullDayReserved') {
      counts.fullDayReserved++;
    }
  }

  if (seatIndex !== -1) {
    for (var seat = 1; seat <= totalSeats; seat++) {
      var seatStatus = seatStatuses[seat];
      if (seatStatus === 'halfDay') {
        counts.halfDay++;
      } else if (seatStatus === 'fullDayReserved') {
        counts.fullDayReserved++;
      }
    }
  }

  var unknownStatusList = Object.keys(unsupportedStatuses);
  if (unknownStatusList.length) {
    throw new Error('Unsupported occupancy status values: ' + unknownStatusList.join(', '));
  }

  if (counts.halfDay + counts.fullDayReserved > totalSeats) {
    throw new Error('Seat counts exceed the configured total of ' + totalSeats + '.');
  }

  return counts;
}

function buildOccupancyCsvRequestUrl(baseUrl) {
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

  fetch(buildOccupancyCsvRequestUrl(OCC_CSV_URL), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status + '.');
      }
      return response.text();
    })
    .then(function (csvText) {
      var counts = summarizeOccupancyCsv(csvText, OCC.total);
      OCC.halfDay = counts.halfDay;
      OCC.fullDayReserved = counts.fullDayReserved;
      OCC.date = formatOccupancyTimestamp(new Date());
      renderOccupancy();
      occRefreshInFlight = false;
      if (source === 'manual') {
        setOccupancyRefreshUi('idle', 'Seat data refreshed just now.');
      } else if (source === 'initial') {
        setOccupancyRefreshUi('idle', 'Live occupancy sync is active.');
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
      } else if (source === 'initial') {
        setOccupancyRefreshUi('idle', 'Live sync is unavailable right now. Showing the last available data.');
      } else {
        setOccupancyRefreshUi('idle', 'Showing the last available data.');
      }
    });
}

function renderOccupancy() {
  var o      = OCC;
  var taken  = o.halfDay + o.fullDayReserved;
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
  var halfDayPct = Math.round((o.halfDay / o.total) * 100);
  var fullDayPct = Math.round((o.fullDayReserved / o.total) * 100);
  document.getElementById('occ-half-day-pct').textContent = halfDayPct + '%';
  document.getElementById('occ-half-day-bar').style.width = halfDayPct + '%';
  document.getElementById('occ-full-day-pct').textContent = fullDayPct + '%';
  document.getElementById('occ-full-day-bar').style.width = fullDayPct + '%';

  // Build seat grid
  var grid = document.getElementById('seatGrid');
  grid.innerHTML = '';
  for (var i = 0; i < o.total; i++) {
    var s = document.createElement('div');
    s.className = 'seat' +
      (i < o.halfDay                  ? ' half-day' :
       i < o.halfDay + o.fullDayReserved ? ' full-day-reserved' : '');
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
    fetchOccupancyData('initial');
    if (OCC_CSV_URL && window.fetch) {
      window.setInterval(function () {
        fetchOccupancyData('auto');
      }, OCC_POLL_INTERVAL_MS);
    }
  }
  initGalleryLightbox();
});
