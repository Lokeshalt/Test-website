const fs = require('fs');
const https = require('https');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvw5mFJQ-esd6lSpevUKdpzphem3oD5mcVnNbds9TjPRSu929Q8t1eCz7uuoTVeI8FLKTcFSpAeJWY/pub?output=csv';
const OUTPUT_PATH = 'occupancy.json';

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function classifyStatus(value) {
  const normalized = normalizeStatus(value);

  if (!normalized || normalized === 'available') {
    return 'Available';
  }

  if (normalized.includes('half') && normalized.includes('day')) {
    return 'Half Day';
  }

  if (normalized.includes('full') && normalized.includes('day')) {
    return 'Full Day';
  }

  return '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index++;
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
        index++;
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

  return rows.filter((currentRow) =>
    currentRow.some((cell) => String(cell || '').trim() !== '')
  );
}

function getColumnIndex(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function buildSnapshot(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error('The occupancy CSV is empty.');
  }

  const headers = rows[0].map(normalizeHeader);
  const seatIndex = getColumnIndex(headers, ['seat', 'seats', 'seatnumber', 'seatno']);
  const statusIndex = getColumnIndex(headers, ['status', 'seatstatus', 'occupancystatus']);

  if (seatIndex === -1) {
    throw new Error('The occupancy CSV must include a Seat column.');
  }

  if (statusIndex === -1) {
    throw new Error('The occupancy CSV must include a Status column.');
  }

  const seatMap = new Map();
  const skippedRows = [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const rawSeat = row[seatIndex];
    const rawStatus = row[statusIndex];

    if (!String(rawSeat || '').trim() && !String(rawStatus || '').trim()) {
      continue;
    }

    const seatNumber = parseInt(String(rawSeat || '').trim(), 10);
    const status = classifyStatus(rawStatus);

    if (Number.isNaN(seatNumber) || seatNumber < 1) {
      skippedRows.push(`row ${index + 1}: invalid seat "${rawSeat}"`);
      continue;
    }

    if (!status) {
      skippedRows.push(`row ${index + 1}: unsupported status "${rawStatus}"`);
      continue;
    }

    seatMap.set(seatNumber, status);
  }

  if (!seatMap.size) {
    throw new Error('No valid seat rows were found in the occupancy CSV.');
  }

  if (skippedRows.length) {
    console.warn(`Skipped ${skippedRows.length} row(s):`);
    skippedRows.forEach((message) => console.warn(`- ${message}`));
  }

  const seats = Array.from(seatMap.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([seat, status]) => ({ seat, status }));

  return {
    updatedAt: new Date().toISOString(),
    seats
  };
}

function fetchCsv(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        if (redirectCount >= 5) {
          reject(new Error('Too many redirects while fetching the occupancy CSV.'));
          response.resume();
          return;
        }

        const nextUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(fetchCsv(nextUrl, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Request failed with status ${response.statusCode}.`));
        response.resume();
        return;
      }

      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const csvText = await fetchCsv(CSV_URL);
  const snapshot = buildSnapshot(csvText);

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${OUTPUT_PATH} with ${snapshot.seats.length} seat rows.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
