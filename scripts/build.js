const path = require('path');
const https = require('https');
const fs = require('fs');

const SHEET_ID = '1S1a3OH6U-7nySBxNRqzBL83CEXEjRZDFEMWC2kUepFA';
const tabs = ['Sheet25', 'Sheet26', 'Sheet27', 'Form 1/9/2026-copy', 'Form 7-9-2026'];

// GID map — use export?format=csv&gid=GID which bypasses ALL Google Sheets UI filters
const SHEET_GID_MAP = {
  'Sheet25': '489850416',
  'Sheet26': '1406811815',
  'Sheet27': '193385057',
  'Form 1/9/2026-copy': '1471405191',
  'Form 7-9-2026': '131674355',
  'Meta_Spend_Daily': 'gviz'  // no filter risk on Meta spend; keep gviz
};


function fetchWithRedirects(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    lib.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
          && res.headers.location && maxRedirects > 0) {
        const newUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : 'https://docs.google.com' + res.headers.location;
        res.resume();
        resolve(fetchWithRedirects(newUrl, maxRedirects - 1));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

function fetchCSV(tab) {
  const gid = SHEET_GID_MAP[tab];
  // Use export endpoint (bypasses ALL Google Sheets UI filters) for CRM tabs
  // Fall back to gviz for tabs without a numeric GID (e.g. Meta_Spend_Daily — no filter risk)
  const isNumericGid = gid && gid !== 'gviz';
  const url = isNumericGid
    ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  return fetchWithRedirects(url);
}




function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    let next = text[i+1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (cur !== '' || row.length > 0) {
        row.push(cur);
        lines.push(row);
        row = [];
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    lines.push(row);
  }
  return lines;
}


function normalizeName(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[ \t\n\r_|+–-]+/g, ' ').trim();
}

function buildCanonicalIdMaps(leads) {
  const nameToCampId = {};
  const prefixToCampId = {};
  const nameToAdsetId = {};
  const prefixToAdsetId = {};
  const nameToAdId = {};
  const prefixToAdId = {};

  leads.forEach(l => {
    const cId = l.campaignId;
    const cName = l.campaignName;
    const asId = l.adsetId;
    const asName = l.adsetName;
    const aId = l.adId;
    const aName = l.adName;

    if (cId && cName) {
      nameToCampId[normalizeName(cName)] = cId;
      if (cId.length >= 13) prefixToCampId[cId.slice(0, 13)] = cId;
    }
    if (asId && asName) {
      nameToAdsetId[normalizeName(asName)] = asId;
      if (asId.length >= 13) prefixToAdsetId[asId.slice(0, 13)] = asId;
    }
    if (aId && aName) {
      nameToAdId[normalizeName(aName)] = aId;
      if (aId.length >= 13) prefixToAdId[aId.slice(0, 13)] = aId;
    }
  });

  return {
    resolveCampId: (id, name) => (name && nameToCampId[normalizeName(name)]) || (id && id.length >= 13 && prefixToCampId[id.slice(0, 13)]) || id,
    resolveAdsetId: (id, name) => (name && nameToAdsetId[normalizeName(name)]) || (id && id.length >= 13 && prefixToAdsetId[id.slice(0, 13)]) || id,
    resolveAdId: (id, name) => (name && nameToAdId[normalizeName(name)]) || (id && id.length >= 13 && prefixToAdId[id.slice(0, 13)]) || id
  };
}

function cleanText(val) {
  if (!val) return '';
  let str = String(val).trim();
  str = str
    .replace(/بعت 3 مرات [\uFFFD?]+ردش/g, 'بعت 3 مرات مردش')
    .replace(/بع[\uFFFD?]+ 3 مرات مش بيرد/g, 'بعت 3 مرات مش بيرد')
    .replace(/ي[\uFFFD?]+طب/g, 'يشطب')
    .replace(/بير[\uFFFD?]+/g, 'بيرد')
    .replace(/مر[\uFFFD?]+ت/g, 'مرات')
    .replace(/ااسب[\uFFFD?]+ع/g, 'الاسبوع')
    .replace(/اندرو سمي[\uFFFD?]+/g, 'اندرو سمير')
    .replace(/ا[\uFFFD?]+اسكندريه/g, 'الاسكندريه')
    .replace(/ان[\uFFFD?]+ل مصر/g, 'انزل مصر')
    .replace(/شر[\uFFFD?]+ه تانيه/g, 'شركة تانيه')
    .replace(/ال[\uFFFD?]+صميم/g, 'التصميم')
    .replace(/وي[\uFFFD?]+د عليا/g, 'ويرد عليا')
    .replace(/[\uFFFD\uFFFE]/g, '');
  return str.replace(/^(p:|l:|ag:|as:|c:|f:)/, '').trim();
}

function parseDateStr(dt) {
  if (!dt) return '';
  const m = String(dt).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function cleanCondition(cond) {
  if (!cond) return 'Unspecified';
  if (cond.includes('semi-finished') || cond.includes('نصف_تشطيب') || cond.includes('نصف تشطيب')) return 'Semi-Finished (نصف تشطيب)';
  if (cond.includes('fully_finished') || cond.includes('متشطبة_بالفعل') || cond.includes('متشطبة')) return 'Fully Finished (متشطبة)';
  if (cond.includes('red_brick') || cond.includes('الطوب_الأحمر') || cond.includes('طوب أحمر')) return 'Core & Shell (طوب أحمر)';
  return cond.replace(/\(.*?\)/g, '').replace(/_/g, ' ').trim() || 'Unspecified';
}

function parseArea(area) {
  if (!area) return { areaNum: 0, areaCat: 'Unspecified' };
  let str = String(area).trim();
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  for (let i = 0; i < 10; i++) {
    str = str.split(arabicDigits[i]).join(i);
  }
  str = str.replace(/(متر\s*مربع|م2|م²|m2|sqm|sq\.m)/gi, '').trim();
  const rangeMatch = str.match(/(\d+)\s*[-_–/to]+\s*(\d+)/i);
  if (rangeMatch) {
    const n1 = parseFloat(rangeMatch[1]);
    const n2 = parseFloat(rangeMatch[2]);
    const avg = (n1 + n2) / 2;
    let cat = 'Unspecified';
    if (avg < 150) cat = '< 150 m²';
    else if (avg <= 250) cat = '150 - 250 m²';
    else cat = '> 250 m²';
    return { areaNum: avg, areaCat: cat };
  }
  const numMatch = str.match(/(\d+(\.\d+)?)/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    let cat = 'Unspecified';
    if (num > 0 && num < 150) cat = '< 150 m²';
    else if (num >= 150 && num <= 250) cat = '150 - 250 m²';
    else if (num > 250) cat = '> 250 m²';
    return { areaNum: num, areaCat: cat };
  }
  return { areaNum: 0, areaCat: 'Unspecified' };
}

function extractHiddenRows(headerRow) {
  const firstCol = (headerRow[0] || '').trim();
  const idsInFirstCol = (firstCol.match(/\bl:\d+/g) || []);
  if (idsInFirstCol.length === 0) return [];

  const splitByPrefix = (cell, prefix) => {
    if (!cell) return [];
    const re = new RegExp('\\b' + prefix + '\\d+', 'g');
    const matches = cell.match(re);
    if (!matches) return [];
    return matches.map(m => m.replace(prefix, '').trim());
  };

  const splitDates = (cell) => {
    if (!cell) return [];
    const matches = cell.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/g);
    return matches || [];
  };

  const idCol = splitByPrefix(headerRow[0], 'l:');
  const createdCol = splitDates(headerRow[1]);
  const adIdCol = splitByPrefix(headerRow[2], 'ag:');
  const adsetIdCol = splitByPrefix(headerRow[4], 'as:');
  const campIdCol = splitByPrefix(headerRow[6], 'c:');

  const count = idCol.length;
  const recovered = [];
  for (let i = 0; i < count; i++) {
    const row = new Array(headerRow.length).fill('');
    row[0] = idCol[i] || '';
    row[1] = createdCol[i] || '';
    row[2] = adIdCol[i] || '';
    row[4] = adsetIdCol[i] || '';
    row[6] = campIdCol[i] || '';
    recovered.push(row);
  }
  return recovered;
}

async function generatePerfectPortal() {
  console.log('Fetching live sheets data to build precision isolated attribution portal...');

  // 1. Strict CRM Leads from all active tabs FIRST to establish canonical dictionary
  const strictLeadsList = [];
  for (const tab of tabs) {
    const csv = await fetchCSV(tab);
    const rows = parseCSV(csv);
    if (rows.length <= 1) continue;

    const rawHeaders = rows[0];
    const headers = rawHeaders.map(h => {
      const clean = cleanText(h).toLowerCase().trim();
      return clean.split(/\s+/)[0];
    });

    const idIdx = headers.findIndex(h => h === 'id');
    const createdIdx = headers.findIndex(h => h === 'created_time' || h === 'created' || h === 'create');
    const adIdIdx = headers.findIndex(h => h === 'ad_id');
    const adIdx = headers.findIndex(h => h === 'ad_name');
    const adsetIdIdx = headers.findIndex(h => h === 'adset_id');
    const adsetIdx = headers.findIndex(h => h === 'adset_name');
    const campIdIdx = headers.findIndex(h => h === 'campaign_id');
    const campIdx = headers.findIndex(h => h === 'campaign_name');
    const condIdx = headers.findIndex(h => h.includes('condition') || h.includes('حالة'));
    const areaIdx = headers.findIndex(h => h.includes('area') || h.includes('مساحة'));
    const locIdx = headers.findIndex(h => h.includes('unit_location') || h.includes('government') || h.includes('محافظة'));
    const nameIdx = headers.findIndex(h => h === 'full_name' || (h.includes('name') && !h.includes('ad') && !h.includes('campaign') && !h.includes('form') && !h.includes('set') && !h.includes('owner')));
    const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('هاتف') || h.includes('mobile'));
    const statusIdx = headers.findIndex(h => h === 'lead_status' || h === 'status');
    const notesIdx = headers.findIndex(h => h === 'note' || h === 'notes');
    const ownerIdx = headers.findIndex(h => h.includes('owner') || h.includes('agent') || h.includes('assign'));
    const meetingIdx = headers.findIndex(h => h.includes('scanning') || h.includes('meeting'));
    const dealIdx = headers.findIndex(h => h.includes('deal') || h.includes('تعاقد'));

    const hiddenRows = extractHiddenRows(rawHeaders);
    const allRows = [...hiddenRows, ...rows.slice(1)];

    allRows.forEach((r) => {
      if (r.every(c => !c || c.trim() === '')) return;
      const id = idIdx !== -1 ? cleanText(r[idIdx]) : '';
      const name = nameIdx !== -1 ? cleanText(r[nameIdx]) : '';
      const phone = phoneIdx !== -1 ? cleanText(r[phoneIdx]) : '';
      const rawCreated = createdIdx !== -1 ? cleanText(r[createdIdx]) : '';
      let adId = adIdIdx !== -1 ? cleanText(r[adIdIdx]) : '';
      let adName = adIdx !== -1 ? cleanText(r[adIdx]) : '';
      let adsetId = adsetIdIdx !== -1 ? cleanText(r[adsetIdIdx]) : '';
      let adsetName = adsetIdx !== -1 ? cleanText(r[adsetIdx]) : '';
      let campaignId = campIdIdx !== -1 ? cleanText(r[campIdIdx]) : '';
      let campaignName = campIdx !== -1 ? cleanText(r[campIdx]) : '';

      if (!adName) adName = 'General Ad';
      if (!campaignName) campaignName = (tab === 'Sheet25' || tab === 'Form 1/9/2026-copy' || tab === 'Form 7-9-2026') ? 'Cost Plus Campaign' : (tab === 'Sheet26' ? 'Expatriates Campaign' : 'Your Time is Precious');

      const cond = condIdx !== -1 ? cleanCondition(cleanText(r[condIdx])) : 'Unspecified';
      const areaInfo = areaIdx !== -1 ? parseArea(cleanText(r[areaIdx])) : { areaNum: 0, areaCat: 'Unspecified' };
      const loc = locIdx !== -1 ? cleanText(r[locIdx]) : 'القاهرة / الجيزة';
      const status = statusIdx !== -1 ? cleanText(r[statusIdx]) : 'No Answer';
      const notes = notesIdx !== -1 ? cleanText(r[notesIdx]) : '-';
      let owner = ownerIdx !== -1 ? cleanText(r[ownerIdx]) : 'Unassigned';
      if (owner.includes('|') || owner.includes('Lead Form')) owner = 'Unassigned';

      const dateFormatted = parseDateStr(rawCreated);
      const meetingDate = meetingIdx !== -1 ? parseDateStr(cleanText(r[meetingIdx])) : '';
      const dealDate = dealIdx !== -1 ? parseDateStr(cleanText(r[dealIdx])) : '';
      const country = phone.startsWith('+966') || phone.startsWith('966') ? 'KSA (السعودية)' : (phone.startsWith('+20') || phone.startsWith('20') || phone.startsWith('01') ? 'Egypt (مصر)' : 'Gulf / Other');

      strictLeadsList.push({
        id,
        name: name || 'عميل',
        phone: phone || '-',
        country,
        date: dateFormatted || '2026-08-01',
        rawCreated,
        adId,
        adName,
        adsetId,
        adsetName,
        campaignId,
        campaignName,
        areaNum: areaInfo.areaNum,
        areaCategory: areaInfo.areaCat,
        condition: cond,
        location: loc || 'القاهرة / الجيزة',
        status: status || 'No Answer',
        owner: owner || 'Unassigned',
        notes: notes || '-',
        meetingDate,
        dealDate,
        sheetSource: tab
      });
    });
  }

  strictLeadsList.sort((a, b) => (a.date > b.date ? 1 : -1));
  console.log(`Total Strict Live CRM Leads: ${strictLeadsList.length}`);

  // Build Canonical ID Maps from CRM Leads
  const canonMaps = buildCanonicalIdMaps(strictLeadsList);

  // 2. Meta Spend Tab with Canonical ID Normalization
  const metaCsv = await fetchCSV('Meta_Spend_Daily');
  const metaRows = parseCSV(metaCsv);
  const metaList = [];
  const metaAdMap = {};
  const metaAdsetMap = {};
  const metaCampMap = {};

  if (metaRows.length > 1) {
    metaRows.slice(1).forEach(r => {
      if (r.every(c => !c || c.trim() === '')) return;
      const rawDate = cleanText(r[0]);
      const day = parseDateStr(rawDate) || rawDate;
      const rawCampName = cleanText(r[1]) || 'General Campaign';
      const rawCampId = cleanText(r[2]) || '';
      const rawAdsetName = cleanText(r[3]) || 'General Ad Set';
      const rawAdsetId = cleanText(r[4]) || '';
      const rawAdName = cleanText(r[5]) || 'General Ad';
      const rawAdId = cleanText(r[6]) || '';
      const spend = parseFloat(cleanText(r[7]).replace(/,/g, '')) || 0;
      const results = parseInt(cleanText(r[9])) || 0;

      // Apply canonical resolution to bypass Google Sheets 15-digit precision rounding
      const campaignId = canonMaps.resolveCampId(rawCampId, rawCampName);
      const campaignName = rawCampName;
      const adsetId = canonMaps.resolveAdsetId(rawAdsetId, rawAdsetName);
      const adsetName = rawAdsetName;
      const adId = canonMaps.resolveAdId(rawAdId, rawAdName);
      const adName = rawAdName;

      if (adId && adName) metaAdMap[adId] = adName;
      if (adsetId && adsetName) metaAdsetMap[adsetId] = adsetName;
      if (campaignId && campaignName) metaCampMap[campaignId] = campaignName;

      if (day && (spend > 0 || results > 0)) {
        metaList.push({
          day,
          campaignName,
          campaignId,
          adsetName,
          adsetId,
          adName,
          adId,
          spend,
          results
        });
      }
    });
  }
  console.log(`Parsed ${metaList.length} Meta Spend records (with canonical ID normalization).`);

  const portalHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Amlaak Design — BI Portal & Meta Campaigns Engine 2.0</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * {
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    body {
      font-family: 'Cairo', sans-serif;
      background: radial-gradient(circle at top right, #111d33, #070d18);
      color: #f1f5f9;
      min-height: 100vh;
    }
    .gold-gradient {
      background: linear-gradient(135deg, #fce8a5 0%, #c5a059 50%, #9a7329 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .glass-card {
      background: rgba(18, 30, 50, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(197, 160, 89, 0.22);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      transition: all 0.25s ease;
    }
    .glass-card:hover {
      border-color: rgba(197, 160, 89, 0.45);
    }
    .hub-card {
      background: linear-gradient(145deg, rgba(20, 35, 60, 0.9), rgba(11, 25, 44, 0.95));
      border: 1px solid rgba(197, 160, 89, 0.3);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .hub-card:hover {
      transform: translateY(-4px);
      border-color: rgba(197, 160, 89, 0.8);
      box-shadow: 0 16px 36px rgba(197, 160, 89, 0.18);
    }
    input[type=range] {
      accent-color: #c5a059;
    }
    input[type=date]::-webkit-calendar-picker-indicator {
      filter: invert(0.85);
      cursor: pointer;
    }
    .touch-scroll {
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: #c5a059 #0b192c;
    }
    .apexcharts-datalabel, 
    .apexcharts-datalabels text, 
    .apexcharts-data-labels text {
      fill: #ffffff !important;
      color: #ffffff !important;
      font-weight: 800 !important;
      font-family: 'Cairo', 'Outfit', sans-serif !important;
    }
    .spin-animation {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body class="p-3 sm:p-4 md:p-6 lg:p-8">

  <!-- SECURITY PIN GATE OVERLAY -->
  <div id="securityGate" class="fixed inset-0 z-50 flex items-center justify-center bg-[#070d18]/95 backdrop-blur-xl p-4">
    <div class="glass-card max-w-md w-full p-6 sm:p-8 rounded-3xl border-amber-500/40 text-center shadow-2xl">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#c5a059] to-amber-200 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-900/40">
        <i class="fa-solid fa-shield-halved text-2xl text-[#0b192c]"></i>
      </div>
      <h2 class="text-xl sm:text-2xl font-black gold-gradient mb-1">Amlaak Design | Security PIN</h2>
      <p class="text-xs text-slate-400 mb-6 font-semibold">لوحة التحكم مقيدة ومحمية. الرجاء إدخال الـ PIN السري للمتابعة.</p>
      
      <div class="mb-4">
        <input type="password" id="pinInput" placeholder="أدخل الـ PIN السري..." class="w-full px-4 py-3 rounded-2xl bg-[#0b192c] border border-amber-500/40 text-center text-lg text-white font-mono tracking-widest focus:outline-none focus:border-amber-400 transition" onkeydown="if(event.key==='Enter') unlockDashboard()">
        <p id="pinError" class="text-xs text-rose-400 font-bold mt-2 hidden flex items-center justify-center gap-1">
          <i class="fa-solid fa-circle-exclamation"></i> الـ PIN غير صحيح! برجاء المحاولة مجدداً.
        </p>
      </div>

      <button onclick="unlockDashboard()" class="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#c5a059] to-amber-500 text-[#0b192c] font-black text-sm hover:brightness-110 active:scale-95 transition shadow-lg shadow-amber-900/30 flex items-center justify-center gap-2">
        <i class="fa-solid fa-lock-open"></i> تسجيل الدخول (Unlock)
      </button>
      
      <div class="mt-4 text-[10px] text-slate-500">
        <i class="fa-solid fa-lock text-amber-500"></i> متصل مباشرة بـ Google Sheets — مشفر ومحمي
      </div>
    </div>
  </div>

  <!-- PORTAL HUB SCREEN (LANDING AFTER PIN) -->
  <div id="portalHub" class="hidden min-h-[85vh] flex flex-col justify-center items-center py-8">
    <div class="text-center max-w-2xl mb-10">
      <div class="w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#c5a059] to-amber-200 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-amber-900/40">
        <i class="fa-solid fa-crown text-3xl text-[#0b192c]"></i>
      </div>
      <h1 class="text-2xl sm:text-4xl font-black gold-gradient mb-2">Amlaak Design Executive BI Portal</h1>
      <p class="text-xs sm:text-sm text-slate-400 font-semibold">منظومة ذكاء الأعمال المتكاملة — اختر لوحة التحكم والتحليلات المطلوبة</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full px-4">
      
      <!-- CARD 1: LEADS & CRM OPERATIONS -->
      <div onclick="switchView('LEADS')" class="hub-card rounded-3xl p-6 sm:p-8 cursor-pointer flex flex-col justify-between group">
        <div>
          <div class="flex items-center justify-between mb-5">
            <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl group-hover:scale-110 transition">
              <i class="fa-solid fa-users-viewfinder"></i>
            </div>
            <span class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold font-mono">100% Live CRM</span>
          </div>
          <h3 class="text-xl font-black text-white group-hover:text-[#fce8a5] transition mb-2">1. لوحة العملاء وإدارة المبيعات (Leads CRM)</h3>
          <p class="text-xs text-slate-400 leading-relaxed mb-6">متابعة وتأهيل ليدات الشيت الحية، الفئة المستهدفة (150-250م²)، فلاتر المحافظات، حالة الوحدات، Scanning المُنجزة، والعقود الموقعة مع واتساب مباشر.</p>
        </div>
        <div class="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2 text-[11px] text-amber-300/80 font-bold">
            <i class="fa-solid fa-table-list"></i> <span id="hubLeadsCount">Loading...</span>
          </div>
          <div class="flex items-center gap-1.5 text-xs font-black text-[#c5a059] group-hover:translate-x-[-4px] transition">
            <span>فتح لوحة العملاء</span> <i class="fa-solid fa-arrow-left"></i>
          </div>
        </div>
      </div>

      <!-- CARD 2: META CAMPAIGNS & ADS PERFORMANCE -->
      <div onclick="switchView('CAMPAIGNS')" class="hub-card rounded-3xl p-6 sm:p-8 cursor-pointer flex flex-col justify-between group">
        <div>
          <div class="flex items-center justify-between mb-5">
            <div class="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 text-2xl group-hover:scale-110 transition">
              <i class="fa-solid fa-chart-line"></i>
            </div>
            <span class="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold font-mono">Meta Ads & Funnel 2.0</span>
          </div>
          <h3 class="text-xl font-black text-white group-hover:text-[#fce8a5] transition mb-2">2. لوحة الحملات والمصروفات (Meta Campaigns)</h3>
          <p class="text-xs text-slate-400 leading-relaxed mb-6">تحليل الصرف وتكلفة الليد والمؤهل والمقابلات والعقود مع عزل دقيق للإعلانات المتشابهة (Cost Plus لكل حملة ومجموعة على حدة).</p>
        </div>
        <div class="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2 text-[11px] text-blue-300 font-mono font-bold">
            <i class="fa-solid fa-wallet"></i> <span id="hubSpendTotal">Loading Spend...</span>
          </div>
          <div class="flex items-center gap-1.5 text-xs font-black text-blue-400 group-hover:translate-x-[-4px] transition">
            <span>فتح لوحة الحملات</span> <i class="fa-solid fa-arrow-left"></i>
          </div>
        </div>
      </div>

    </div>

    <div class="mt-10">
      <button onclick="lockDashboard()" class="px-5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 active:scale-95 transition text-xs font-bold flex items-center gap-2">
        <i class="fa-solid fa-lock"></i> قفل الجلسة (Lock Session)
      </button>
    </div>
  </div>

  <!-- MAIN APPLICATION CONTAINER -->
  <div id="mainDashboard" class="hidden">
    
    <!-- TOP HEADER -->
    <header class="flex flex-col md:flex-row items-center justify-between pb-4 sm:pb-5 mb-4 sm:mb-5 border-b border-slate-800 gap-3 sm:gap-4">
      <div class="flex items-center gap-3 w-full md:w-auto">
        <div onclick="switchView('HUB')" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-[#c5a059] to-amber-200 flex-shrink-0 flex items-center justify-center shadow-lg shadow-amber-900/30 cursor-pointer" title="العودة للرئيسية">
          <i class="fa-solid fa-crown text-xl sm:text-2xl text-[#0b192c]"></i>
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-lg sm:text-2xl md:text-3xl font-black gold-gradient">Amlaak Design</h1>
            <span id="liveStatusBadge" class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] sm:text-[11px] font-bold border border-emerald-500/30 flex items-center gap-1 font-mono">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Live Google Sheet
            </span>
          </div>
          <p id="lastSyncTime" class="text-[10px] sm:text-xs text-slate-400 font-semibold">متصل بسحابة جوجل — جاري التحديث التلقائي الشامل...</p>
        </div>
      </div>

      <!-- VIEW NAVIGATION TABS & ACTIONS -->
      <div class="flex items-center gap-2 flex-wrap w-full md:w-auto justify-between md:justify-end">
        <!-- View Switcher -->
        <div class="bg-slate-900/90 p-1 rounded-2xl border border-slate-800 flex items-center gap-1">
          <button onclick="switchView('LEADS')" id="navBtnLeads" class="px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 bg-[#c5a059] text-[#0b192c] shadow-sm">
            <i class="fa-solid fa-users"></i> <span>Leads CRM</span>
          </button>
          <button onclick="switchView('CAMPAIGNS')" id="navBtnCampaigns" class="px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 text-slate-400 hover:text-white">
            <i class="fa-solid fa-bullhorn"></i> <span>Meta Campaigns</span>
          </button>
          <button onclick="switchView('HUB')" title="Portal Home" class="p-1.5 px-2 rounded-xl text-slate-400 hover:text-[#fce8a5] transition text-xs">
            <i class="fa-solid fa-grip"></i>
          </button>
        </div>

        <!-- Sync Button -->
        <button onclick="fetchLiveGoogleData(true)" id="btnSyncNow" class="px-3 py-2 rounded-xl bg-[#c5a059]/20 border border-[#c5a059]/40 text-[#fce8a5] hover:bg-[#c5a059] hover:text-[#0b192c] active:scale-95 transition font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm">
          <i id="syncIcon" class="fa-solid fa-rotate"></i> <span>Sync</span>
        </button>

        <!-- Export CSV -->
        <button onclick="handleExport()" class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white hover:bg-slate-700 active:scale-95 transition font-bold text-xs flex items-center justify-center gap-1.5 shadow-md">
          <i class="fa-solid fa-file-excel text-emerald-400"></i> Export
        </button>

        <!-- Lock Button -->
        <button onclick="lockDashboard()" title="Lock Dashboard" class="p-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-rose-400 active:scale-95 transition">
          <i class="fa-solid fa-right-from-bracket text-sm"></i>
        </button>
      </div>
    </header>

    <!-- SECTION 1: LEADS & CRM OPERATIONS VIEW -->
    <div id="leadsView" class="hidden">
      
      <!-- COMPLETE LEADS FILTER BAR -->
      <div class="glass-card rounded-2xl p-4 sm:p-5 mb-5 border-amber-500/30">
        
        <!-- Row 1: Dates & Quick Buttons -->
        <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-4 gap-3">
          <div class="flex items-center gap-2 text-[#c5a059] font-bold text-xs sm:text-sm">
            <i class="fa-solid fa-sliders text-sm"></i> فلاتر العملاء المتقدمة (Leads CRM Multi-Filters)
          </div>

          <!-- Date Presets -->
          <div class="grid grid-cols-4 sm:flex items-center gap-1.5 w-full lg:w-auto">
            <button onclick="setLeadsDatePreset('ALL')" id="btnDateAll" class="px-3 py-1.5 rounded-xl bg-[#c5a059] text-[#0b192c] font-black text-[11px] text-center transition shadow-sm">All Time</button>
            <button onclick="setLeadsDatePreset('JULY')" id="btnDateJuly" class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-[#c5a059] text-[11px] text-slate-300 font-semibold text-center transition">July 2026</button>
            <button onclick="setLeadsDatePreset('AUG')" id="btnDateAug" class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-[#c5a059] text-[11px] text-slate-300 font-semibold text-center transition">August 2026</button>
            <button onclick="setLeadsDatePreset('LAST7')" id="btnDateLast7" class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-[#c5a059] text-[11px] text-slate-300 font-semibold text-center transition">Last 7 Days</button>
          </div>
        </div>

        <!-- Row 2: Date Inputs & Quick Category Toggles -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end mb-4">
          <div>
            <label class="block text-[11px] text-slate-400 mb-1 font-bold">من تاريخ (Start Date):</label>
            <input type="date" id="startDateInput" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-[#c5a059]" onchange="handleLeadsDateChange()">
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1 font-bold">إلى تاريخ (End Date):</label>
            <input type="date" id="endDateInput" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-[#c5a059]" onchange="handleLeadsDateChange()">
          </div>
          <div class="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button onclick="toggleQuickFilter('QUALIFIED')" id="btnQuickQual" class="py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600 hover:text-white active:scale-95 transition font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm">
              <i class="fa-solid fa-star text-amber-400"></i> Qualified
            </button>
            <button onclick="toggleQuickFilter('MID_AREA')" id="btnQuickMid" class="py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-[#c5a059] hover:text-[#0b192c] active:scale-95 transition font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm">
              <i class="fa-solid fa-ruler-combined text-amber-400"></i> 150-250m²
            </button>
            <button onclick="toggleQuickFilter('KSA')" id="btnQuickKsa" class="py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-600 hover:text-white active:scale-95 transition font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm">
              <i class="fa-solid fa-globe text-purple-400"></i> KSA
            </button>
            <button onclick="toggleQuickFilter('MEETING')" id="btnQuickMeeting" class="py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600 hover:text-white active:scale-95 transition font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm">
              <i class="fa-solid fa-calendar-check text-cyan-400"></i> Scanning
            </button>
          </div>
        </div>

        <!-- Row 3: Dropdown Selectors (Status, Agent, Condition, Country, Search) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-3 border-t border-slate-800">
          <div>
            <label class="block text-[10px] text-slate-400 mb-1 font-bold">الحالة (Status):</label>
            <select id="statusFilter" class="w-full px-2.5 py-1.5 rounded-xl bg-[#0b192c] border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-[#c5a059]" onchange="applyLeadsFilters()">
              <option value="ALL">كل الحالات (All)</option>
              <option value="Qualified">Qualified ✅</option>
              <option value="Not Qualified">Not Qualified ❌</option>
              <option value="No Answer">No Answer ⏳</option>
              <option value="CREATED">CREATED 🆕</option>
            </select>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 mb-1 font-bold">مسؤول المبيعات (Agent):</label>
            <select id="ownerFilter" class="w-full px-2.5 py-1.5 rounded-xl bg-[#0b192c] border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-[#c5a059]" onchange="applyLeadsFilters()">
              <option value="ALL">كل المسؤولين (All)</option>
              <option value="Mariam">Mariam</option>
              <option value="Shahd">Shahd</option>
            </select>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 mb-1 font-bold">حالة الوحدة (Condition):</label>
            <select id="conditionFilter" class="w-full px-2.5 py-1.5 rounded-xl bg-[#0b192c] border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-[#c5a059]" onchange="applyLeadsFilters()">
              <option value="ALL">كل حالات الوحدات</option>
              <option value="Semi-Finished">Semi-Finished (نصف تشطيب)</option>
              <option value="Core & Shell">Core & Shell (طوب أحمر)</option>
              <option value="Fully Finished">Fully Finished (متشطبة)</option>
            </select>
          </div>

          <div>
            <label class="block text-[10px] text-slate-400 mb-1 font-bold">الدولة (Country):</label>
            <select id="countryFilter" class="w-full px-2.5 py-1.5 rounded-xl bg-[#0b192c] border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-[#c5a059]" onchange="applyLeadsFilters()">
              <option value="ALL">كل الدول</option>
              <option value="Egypt">Egypt (مصر)</option>
              <option value="KSA">KSA (السعودية)</option>
            </select>
          </div>

          <div class="col-span-2 sm:col-span-1">
            <label class="block text-[10px] text-slate-400 mb-1 font-bold">بحث شامل (Search):</label>
            <input type="text" id="leadsSearchInput" placeholder="بحث بالاسم أو الهاتف أو المنطقة..." class="w-full px-3 py-1.5 rounded-xl bg-[#0b192c] border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#c5a059]" oninput="applyLeadsFilters()">
          </div>
        </div>

        <!-- Dynamic Area Range Scrubber -->
        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="text-xs text-slate-300 font-bold flex items-center gap-2">
            <i class="fa-solid fa-sliders text-amber-400"></i> فلتر الحد الأقصى للمساحة:
            <span id="sliderDisplay" class="font-mono text-amber-300">Up to 500 m²</span>
          </div>
          <input type="range" min="50" max="500" step="10" value="500" class="w-full sm:w-64 cursor-pointer" oninput="handleAreaSlider(this.value)">
        </div>

      </div>

      <!-- LEADS EXECUTIVE KPI CARDS -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-5">
        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-blue-500/30">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>إجمالي العملاء</span> <i class="fa-solid fa-users text-blue-400"></i>
          </div>
          <div id="kpiTotalLeads" class="text-xl sm:text-2xl font-black text-white font-mono">-</div>
          <div class="text-[10px] text-blue-300 mt-1 font-mono">Verified Google Sheet</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-emerald-500/30">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>العملاء المؤهلين</span> <i class="fa-solid fa-circle-check text-emerald-400"></i>
          </div>
          <div id="kpiQualified" class="text-xl sm:text-2xl font-black text-emerald-400 font-mono">-</div>
          <div id="kpiQualRate" class="text-[10px] text-emerald-300 mt-1 font-bold font-mono">0% Conversion</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-amber-500/30">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>150 - 250 m²</span> <i class="fa-solid fa-ruler-combined text-amber-400"></i>
          </div>
          <div id="kpiMidArea" class="text-xl sm:text-2xl font-black text-amber-300 font-mono">-</div>
          <div class="text-[10px] text-slate-400 mt-1">Sweet Spot Units</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-purple-500/30">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>مغتربين السعودية</span> <i class="fa-solid fa-globe text-purple-400"></i>
          </div>
          <div id="kpiKsa" class="text-xl sm:text-2xl font-black text-purple-300 font-mono">-</div>
          <div class="text-[10px] text-slate-400 mt-1">Expatriates (KSA)</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-cyan-500/30">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>Scanning المُنجزة</span> <i class="fa-solid fa-calendar-check text-cyan-400"></i>
          </div>
          <div id="kpiMeetings" class="text-xl sm:text-2xl font-black text-cyan-300 font-mono">-</div>
          <div class="text-[10px] text-cyan-400/80 mt-1 font-bold">Conducted Scanning</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-emerald-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>التعاقدات الموقعة</span> <i class="fa-solid fa-file-signature text-emerald-400"></i>
          </div>
          <div id="kpiDeals" class="text-xl sm:text-2xl font-black text-emerald-300 font-mono">-</div>
          <div class="text-[10px] text-emerald-400 mt-1 font-bold">Signed Deals</div>
        </div>
      </div>

      <!-- LEADS CHARTS GRID -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mb-5">
        
        <!-- Chart 1: Lead Flow Timeline -->
        <div class="glass-card p-4 sm:p-5 rounded-2xl lg:col-span-2">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs sm:text-sm font-bold text-[#c5a059] flex items-center gap-2">
              <i class="fa-solid fa-chart-area"></i> مسار تدفق الليدات اليومي (Daily Lead Flow)
            </h3>
            <span class="text-[11px] text-slate-400 font-mono">Live Timeline</span>
          </div>
          <div id="chartTimeline" class="w-full"></div>
        </div>

        <!-- Chart 2: Qualification Donut -->
        <div class="glass-card p-4 sm:p-5 rounded-2xl">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs sm:text-sm font-bold text-[#c5a059] flex items-center gap-2">
              <i class="fa-solid fa-chart-pie"></i> نسبة التأهيل (Qualification Breakdown)
            </h3>
          </div>
          <div id="chartQualification" class="w-full flex items-center justify-center"></div>
        </div>

      </div>

      <!-- SECONDARY CHARTS GRID -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mb-5">
        
        <!-- Chart 3: Area Distribution -->
        <div class="glass-card p-4 sm:p-5 rounded-2xl">
          <h3 class="text-xs sm:text-sm font-bold text-[#c5a059] mb-3 flex items-center gap-2">
            <i class="fa-solid fa-ruler-combined"></i> توزيع المساحات (Area Distribution)
          </h3>
          <div id="chartArea" class="w-full"></div>
        </div>

        <!-- Chart 4: Location Distribution -->
        <div class="glass-card p-4 sm:p-5 rounded-2xl">
          <h3 class="text-xs sm:text-sm font-bold text-[#c5a059] mb-3 flex items-center gap-2">
            <i class="fa-solid fa-location-dot"></i> الطلب الجغرافي (Geo Demand)
          </h3>
          <div id="chartLocation" class="w-full"></div>
        </div>

        <!-- Chart 5: Unit Condition -->
        <div class="glass-card p-4 sm:p-5 rounded-2xl">
          <h3 class="text-xs sm:text-sm font-bold text-[#c5a059] mb-3 flex items-center gap-2">
            <i class="fa-solid fa-paint-roller"></i> حالة الوحدات (Delivery Condition)
          </h3>
          <div id="chartCondition" class="w-full"></div>
        </div>

      </div>

      <!-- LEADS TABLE -->
      <div class="glass-card rounded-2xl p-4 sm:p-5 mb-5 border-amber-500/30">
        
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-table-list text-[#c5a059]"></i>
            <h3 class="text-xs sm:text-sm font-bold text-white">جدول ليدات الـ CRM المباشر (Direct WhatsApp Follow-up)</h3>
          </div>
          <span class="text-[11px] text-amber-300 font-mono font-bold" id="leadsTableFilteredBadge">Filtered Leads</span>
        </div>

        <div class="overflow-x-auto touch-scroll max-h-[600px] border border-slate-800 rounded-xl">
          <table class="w-full text-right text-xs">
            <thead class="bg-[#0b192c] text-slate-400 font-bold sticky top-0 z-10">
              <tr>
                <th class="p-2.5 sm:p-3">#</th>
                <th class="p-2.5 sm:p-3">Date</th>
                <th class="p-2.5 sm:p-3">Full Name</th>
                <th class="p-2.5 sm:p-3">Phone</th>
                <th class="p-2.5 sm:p-3">Country</th>
                <th class="p-2.5 sm:p-3">Area</th>
                <th class="p-2.5 sm:p-3">Condition</th>
                <th class="p-2.5 sm:p-3">Location</th>
                <th class="p-2.5 sm:p-3">Ad Name</th>
                <th class="p-2.5 sm:p-3">Status</th>
                <th class="p-2.5 sm:p-3">Scanning</th>
                <th class="p-2.5 sm:p-3">Deal</th>
                <th class="p-2.5 sm:p-3">Agent</th>
                <th class="p-2.5 sm:p-3">Notes</th>
                <th class="p-2.5 sm:p-3 text-center">WhatsApp</th>
              </tr>
            </thead>
            <tbody id="leadsTableBody" class="divide-y divide-slate-800 text-slate-300">
            </tbody>
          </table>
        </div>

        <div class="flex justify-between items-center pt-3 mt-2 text-xs text-slate-400 font-bold">
          <span id="leadsRecordCount">Loading data...</span>
          <span class="text-[#c5a059]">Amlaak Design CRM Engine</span>
        </div>
      </div>

    </div>


    <!-- SECTION 2: META CAMPAIGNS & ADS PERFORMANCE VIEW -->
    <div id="campaignsView" class="hidden">
      
      <!-- CASCADING 3-TIER MULTI-FILTER BAR (Campaign -> AdSet -> Ad) -->
      <div class="glass-card rounded-2xl p-4 sm:p-5 mb-5 border-blue-500/30">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3.5 gap-2.5">
          <div class="flex items-center gap-2 text-blue-400 font-bold text-xs sm:text-sm">
            <i class="fa-solid fa-chart-line text-sm"></i> Meta Ads Multi-Level Filtering (تصفية الحملات والمجموعات والإعلانات)
          </div>

          <!-- Granularity Selector -->
          <div class="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <span class="text-[10px] text-slate-400 px-2 font-bold">العرض:</span>
            <button onclick="setGranularity('DAILY')" id="btnGranDaily" class="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] transition">يومي (Daily)</button>
            <button onclick="setGranularity('WEEKLY')" id="btnGranWeekly" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-bold text-[11px] transition">أسبوعي (Weekly)</button>
            <button onclick="setGranularity('MONTHLY')" id="btnGranMonthly" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-bold text-[11px] transition">شهري (Monthly)</button>
          </div>
        </div>

        <!-- 3-Tier Multi-Filter Dropdowns -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <!-- 1. Campaign Filter -->
          <div>
            <label class="block text-[11px] text-blue-300 mb-1 font-bold flex items-center justify-between">
              <span><i class="fa-solid fa-bullhorn text-blue-400 mr-1"></i> 1. الحملة (Campaign):</span>
              <span id="campFilterCount" class="text-[10px] text-slate-400 font-mono"></span>
            </label>
            <select id="metaCampaignSelectFilter" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-blue-500/50 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-400 font-sans" onchange="handleCampaignFilterChange(this.value)">
              <option value="ALL">🌐 كل الحملات (All Campaigns)</option>
            </select>
          </div>

          <!-- 2. Ad Set Filter -->
          <div>
            <label class="block text-[11px] text-purple-300 mb-1 font-bold flex items-center justify-between">
              <span><i class="fa-solid fa-layer-group text-purple-400 mr-1"></i> 2. المجموعة (Ad Set):</span>
              <span id="adsetFilterCount" class="text-[10px] text-slate-400 font-mono"></span>
            </label>
            <select id="metaAdsetSelectFilter" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-purple-500/50 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-400 font-sans" onchange="handleAdsetFilterChange(this.value)">
              <option value="ALL">📁 كل المجموعات الإعلانية (All Ad Sets)</option>
            </select>
          </div>

          <!-- 3. Ad / Creative Filter -->
          <div>
            <label class="block text-[11px] text-amber-300 mb-1 font-bold flex items-center justify-between">
              <span><i class="fa-solid fa-rectangle-ad text-amber-400 mr-1"></i> 3. الإعلان / الكرييتف (Ad):</span>
              <span id="adFilterCount" class="text-[10px] text-slate-400 font-mono"></span>
            </label>
            <select id="metaAdSelectFilter" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-amber-500/50 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-400 font-sans" onchange="handleAdFilterChange(this.value)">
              <option value="ALL">🎬 كل الإعلانات والكرييتف (All Ads)</option>
            </select>
          </div>
        </div>

        <!-- Date Controls Row -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end pt-3 border-t border-slate-800">
          <div>
            <label class="block text-[11px] text-slate-400 mb-1 font-bold">من تاريخ (Start Date):</label>
            <input type="date" id="campStartDateInput" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-400" onchange="handleCampDateChange()">
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1 font-bold">إلى تاريخ (End Date):</label>
            <input type="date" id="campEndDateInput" class="w-full px-3 py-2 rounded-xl bg-[#0b192c] border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-400" onchange="handleCampDateChange()">
          </div>
          <div class="sm:col-span-2 flex items-center gap-1.5 flex-wrap">
            <button onclick="setCampDatePreset('ALL')" id="btnCampAll" class="flex-1 px-3 py-2 rounded-xl bg-blue-600 text-white font-black text-[11px] transition shadow-sm">All Time</button>
            <button onclick="setCampDatePreset('JULY')" id="btnCampJuly" class="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-blue-400 text-[11px] text-slate-300 font-semibold transition">July</button>
            <button onclick="setCampDatePreset('AUG')" id="btnCampAug" class="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-blue-400 text-[11px] text-slate-300 font-semibold transition">August</button>
            <button onclick="setCampDatePreset('SEPT')" id="btnCampSept" class="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-blue-400 text-[11px] text-slate-300 font-semibold transition">Sept</button>
            <button onclick="setCampDatePreset('LAST7')" id="btnCampLast7" class="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-blue-400 text-[11px] text-slate-300 font-semibold transition">7 Days</button>
          </div>
        </div>
      </div>

      <!-- META PERFORMANCE EXECUTIVE KPIS -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        
        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-blue-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>إجمالي الصرف</span> <i class="fa-solid fa-wallet text-blue-400"></i>
          </div>
          <div id="metaKpiSpend" class="text-xl sm:text-2xl font-black text-blue-300 font-mono leading-tight">-</div>
          <div class="text-[10px] text-slate-400 mt-1 font-mono">Amount Spent (EGP)</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-cyan-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>تكلفة الليد (CPL)</span> <i class="fa-solid fa-hand-holding-dollar text-cyan-400"></i>
          </div>
          <div id="metaKpiCPL" class="text-xl sm:text-2xl font-black text-cyan-300 font-mono leading-tight">-</div>
          <div id="metaKpiLeadsCount" class="text-[10px] text-cyan-400/90 mt-1 font-bold font-mono">0 Leads</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-emerald-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>تكلفة المؤهل (CPQL)</span> <i class="fa-solid fa-star text-emerald-400"></i>
          </div>
          <div id="metaKpiCPQL" class="text-xl sm:text-2xl font-black text-emerald-400 font-mono leading-tight">-</div>
          <div id="metaKpiQualRate" class="text-[10px] text-emerald-300 mt-1 font-bold font-mono">0% Qualified</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-purple-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>تكلفة الـ Scanning (CPS)</span> <i class="fa-solid fa-calendar-check text-purple-400"></i>
          </div>
          <div id="metaKpiCPM" class="text-xl sm:text-2xl font-black text-purple-300 font-mono leading-tight">-</div>
          <div id="metaKpiMeetingsCount" class="text-[10px] text-purple-300 mt-1 font-bold font-mono">0 Conducted Scanning</div>
        </div>

        <div class="glass-card p-3.5 sm:p-4 rounded-2xl border-amber-500/40">
          <div class="text-slate-400 text-[11px] font-bold mb-1 flex items-center justify-between">
            <span>تكلفة العقد (CPA)</span> <i class="fa-solid fa-file-contract text-amber-400"></i>
          </div>
          <div id="metaKpiCPA" class="text-xl sm:text-2xl font-black text-amber-300 font-mono leading-tight">-</div>
          <div id="metaKpiDealsCount" class="text-[10px] text-amber-300 mt-1 font-bold font-mono">0 Signed Deals</div>
        </div>

      </div>

      <!-- DUAL-AXIS SPEND VS LEADS TREND CHART -->
      <div class="glass-card p-4 sm:p-5 rounded-2xl mb-5 border-blue-500/30">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 class="text-xs sm:text-sm font-bold text-blue-300 flex items-center gap-2">
            <i class="fa-solid fa-chart-line"></i> منحنى الصرف مقارنة بتدفق الليدات والـ Qualified (Spend vs Funnel)
          </h3>
          <div class="flex items-center gap-3 text-[11px] font-bold font-mono">
            <span class="text-blue-400 flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-blue-500 inline-block"></span> Spend (EGP)</span>
            <span class="text-emerald-400 flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-emerald-500 inline-block"></span> CRM Leads</span>
            <span class="text-amber-400 flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-amber-400 inline-block"></span> Qualified</span>
          </div>
        </div>
        <div id="chartMetaTrend" class="w-full"></div>
      </div>

      <!-- HIERARCHICAL DRILLDOWN TABS -->
      <div class="glass-card rounded-2xl p-4 sm:p-5 mb-5 border-blue-500/30">
        
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800" dir="ltr">
          <div class="flex items-center gap-2">
            <div class="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
              <button onclick="setBreakdownTab('CAMPAIGNS')" id="tabBtnCampaigns" class="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs transition flex items-center gap-1.5">
                <i class="fa-solid fa-bullhorn text-blue-300"></i> Campaigns (الحملات)
              </button>
              <button onclick="setBreakdownTab('ADSETS')" id="tabBtnAdsets" class="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-white font-bold text-xs transition flex items-center gap-1.5">
                <i class="fa-solid fa-layer-group text-purple-300"></i> Ad Sets (المجموعات)
              </button>
              <button onclick="setBreakdownTab('ADS')" id="tabBtnAds" class="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-white font-bold text-xs transition flex items-center gap-1.5">
                <i class="fa-solid fa-rectangle-ad text-amber-300"></i> Ads (الإعلانات)
              </button>
            </div>
          </div>

          <div id="activeFilterNotice" class="hidden items-center gap-2 text-xs text-amber-300 font-bold bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/30" dir="rtl">
            <span>مفلتر حسب:</span>
            <span id="activeFilterLabel" class="font-mono text-white text-[11px]"></span>
            <button onclick="resetMetaDropdownFilters()" class="text-rose-400 hover:underline text-[11px] font-bold">إلغاء التصفية ✖</button>
          </div>
        </div>

        <!-- BREAKDOWN TABLE (LTR DIRECTION) -->
        <div class="overflow-x-auto touch-scroll max-h-[500px] border border-slate-800 rounded-xl" dir="ltr">
          <table class="w-full text-left text-xs font-mono" dir="ltr">
            <thead class="bg-[#0b192c] text-slate-400 font-bold sticky top-0 z-10 text-left">
              <tr id="breakdownTableHeader">
                <!-- Dynamically Rendered LTR -->
              </tr>
            </thead>
            <tbody id="breakdownTableBody" class="divide-y divide-slate-800 text-slate-300 font-mono text-left">
            </tbody>
          </table>
        </div>

        <div class="flex justify-between items-center pt-3 mt-2 text-xs text-slate-400 font-bold">
          <span id="breakdownRecordCount">Rendering breakdown...</span>
          <span class="text-blue-400 font-mono">Meta Marketing Analytics Engine</span>
        </div>

        <!-- COMPARISON PANEL (LTR DIRECTION) -->
        <div id="breakdownComparePanel" class="hidden mt-4 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5" dir="ltr">
          <div id="breakdownComparePanelContent"></div>
        </div>
      </div>

    </div>

  </div>

  <script>
    function normalizeName(str) {
      if (!str) return '';
      return String(str).toLowerCase().replace(/[\\s_|+–-]+/g, ' ').trim();
    }

    function matchIdsOrNames(leadId, leadName, spendId, spendName) {
      if (leadId && spendId && leadId === spendId) return true;
      if (leadId && spendId && leadId.length >= 13 && spendId.length >= 13 && leadId.slice(0, 13) === spendId.slice(0, 13)) return true;
      const n1 = normalizeName(leadName);
      const n2 = normalizeName(spendName);
      if (n1 && n2 && (n1 === n2 || n1.includes(n2) || n2.includes(n1))) return true;
      return false;
    }

    // Secure SHA-256 Hashes for PIN Authentication (Zero Plaintext Secrets)
    const ALLOWED_HASHES = [
      '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab', // SHA-256 for 2026
      'ed946f65d2c785d90e827c5ffd879ce3b49c68d4c88013074176a7e73bc58bcf'  // SHA-256 for 2580
    ];
    const GOOGLE_SHEET_ID = '1S1a3OH6U-7nySBxNRqzBL83CEXEjRZDFEMWC2kUepFA';
    
    const SHEET_TABS = [
      { name: 'Sheet25', gid: '489850416' },
      { name: 'Sheet26', gid: '1406811815' },
      { name: 'Sheet27', gid: '193385057' },
      { name: 'Form 1/9/2026-copy', gid: '1471405191' },
      { name: 'Form 7-9-2026', gid: '131674355' }
    ];

    // Strict Baseline datasets directly parsed from sheets
    const BASELINE_LEADS = ${JSON.stringify(strictLeadsList)};
    const BASELINE_META_SPEND = ${JSON.stringify(metaList)};

    // State Variables
    let currentView = 'HUB';
    let ALL_LEADS = [...BASELINE_LEADS];
    let ALL_META_SPEND = [...BASELINE_META_SPEND];
    let filteredLeads = [];
    let filteredSpend = [];
    
    let leadsStartDate = '2026-07-22';
    let leadsEndDate = getTodayISO();
    let campStartDate = '2026-07-22';
    let campEndDate = getTodayISO();

    let campGranularity = 'DAILY';
    let campBreakdownTab = 'CAMPAIGNS';
    
    // 3-Tier Filter State (Stored as unique IDs or ALL)
    let selectedCampaignId = 'ALL';
    let selectedAdsetId = 'ALL';
    let selectedAdId = 'ALL';

    let quickFilterState = null;

    // Breakdown table sort state (default: sort by CRM Leads desc)
    let breakdownSortCol = 'crmLeads';
    let breakdownSortDir = 'desc';
    // Breakdown row selection for comparison
    let selectedBreakdownRows = {};
    let maxArea = 500;

    // Charts instances
    let chartTimeline = null;
    let chartQualification = null;
    let chartArea = null;
    let chartLocation = null;
    let chartCondition = null;
    let chartMetaTrend = null;

    function getTodayISO() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    async function sha256(str) {
      const buf = new TextEncoder().encode(str);
      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function unlockDashboard() {
      let input = (document.getElementById('pinInput').value || '').trim();
      const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
      let cleanInput = '';
      for (let ch of input) {
        let idx = arabicDigits.indexOf(ch);
        if (idx !== -1) cleanInput += idx;
        else cleanInput += ch;
      }
      cleanInput = cleanInput.trim();

      let isMatch = false;
      try {
        const hash = await sha256(cleanInput);
        if (ALLOWED_HASHES.includes(hash)) isMatch = true;
      } catch (e) {
        console.warn('Crypto hash check error:', e);
      }

      if (isMatch) {
        sessionStorage.setItem('amlaak_auth', 'true');
        document.getElementById('securityGate').classList.add('hidden');
        switchView('HUB');
        fetchLiveGoogleData();
      } else {
        const err = document.getElementById('pinError');
        if (err) err.classList.remove('hidden');
      }
    }

    function lockDashboard() {
      sessionStorage.removeItem('amlaak_auth');
      window.location.reload();
    }

    function switchView(view) {
      currentView = view;
      const hub = document.getElementById('portalHub');
      const main = document.getElementById('mainDashboard');
      const leads = document.getElementById('leadsView');
      const camps = document.getElementById('campaignsView');
      
      const navLeads = document.getElementById('navBtnLeads');
      const navCamps = document.getElementById('navBtnCampaigns');

      if (view === 'HUB') {
        hub.classList.remove('hidden');
        main.classList.add('hidden');
        updateHubCounters();
        return;
      }

      hub.classList.add('hidden');
      main.classList.remove('hidden');

      if (view === 'LEADS') {
        leads.classList.remove('hidden');
        camps.classList.add('hidden');
        navLeads.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 bg-[#c5a059] text-[#0b192c] shadow-sm';
        navCamps.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 text-slate-400 hover:text-white';
        applyLeadsFilters();
      } else if (view === 'CAMPAIGNS') {
        leads.classList.add('hidden');
        camps.classList.remove('hidden');
        navCamps.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 bg-blue-600 text-white shadow-sm';
        navLeads.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 text-slate-400 hover:text-white';
        init3TierMetaFilters();
        applyCampFilters();
      }
    }

    function updateHubCounters() {
      const leadsCountEl = document.getElementById('hubLeadsCount');
      const spendTotalEl = document.getElementById('hubSpendTotal');
      if (leadsCountEl) leadsCountEl.innerText = ALL_LEADS.length + ' Master Leads Available';
      if (spendTotalEl) {
        const totalSpend = ALL_META_SPEND.reduce((acc, row) => acc + (row.spend || 0), 0);
        spendTotalEl.innerText = totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EGP Total Spend';
      }
    }

    function parseCSV(text) {
      const lines = [];
      let row = [];
      let inQuotes = false;
      let cur = '';
      for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        let next = text[i+1];
        if (ch === '"') {
          if (inQuotes && next === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          row.push(cur);
          cur = '';
        } else if ((ch === '\\r' || ch === '\\n') && !inQuotes) {
          if (cur !== '' || row.length > 0) {
            row.push(cur);
            lines.push(row);
            row = [];
            cur = '';
          }
        } else {
          cur += ch;
        }
      }
      if (cur !== '' || row.length > 0) {
        row.push(cur);
        lines.push(row);
      }
      return lines;
    }

    function cleanText(val) {
      if (!val) return '';
      let str = String(val).trim();
      str = str
        .replace(/بعت 3 مرات [\uFFFD?]+ردش/g, 'بعت 3 مرات مردش')
        .replace(/بع[\uFFFD?]+ 3 مرات مش بيرد/g, 'بعت 3 مرات مش بيرد')
        .replace(/ي[\uFFFD?]+طب/g, 'يشطب')
        .replace(/بير[\uFFFD?]+/g, 'بيرد')
        .replace(/مر[\uFFFD?]+ت/g, 'مرات')
        .replace(/ااسب[\uFFFD?]+ع/g, 'الاسبوع')
        .replace(/اندرو سمي[\uFFFD?]+/g, 'اندرو سمير')
        .replace(/ا[\uFFFD?]+اسكندريه/g, 'الاسكندريه')
        .replace(/ان[\uFFFD?]+ل مصر/g, 'انزل مصر')
        .replace(/شر[\uFFFD?]+ه تانيه/g, 'شركة تانيه')
        .replace(/ال[\uFFFD?]+صميم/g, 'التصميم')
        .replace(/وي[\uFFFD?]+د عليا/g, 'ويرد عليا')
        .replace(/[\uFFFD\uFFFE]/g, '');
      return str.replace(/^(p:|l:|ag:|as:|c:|f:)/, '').trim();
    }

    function cleanCondition(cond) {
      if (!cond) return 'Unspecified';
      if (cond.includes('semi-finished') || cond.includes('نصف_تشطيب') || cond.includes('نصف تشطيب')) return 'Semi-Finished (نصف تشطيب)';
      if (cond.includes('fully_finished') || cond.includes('متشطبة_بالفعل') || cond.includes('متشطبة')) return 'Fully Finished (متشطبة)';
      if (cond.includes('red_brick') || cond.includes('الطوب_الأحمر') || cond.includes('طوب أحمر')) return 'Core & Shell (طوب أحمر)';
      return cond.replace(/\\(.*?\\)/g, '').replace(/_/g, ' ').trim() || 'Unspecified';
    }

    function parseArea(area) {
      if (!area) return { areaNum: 0, areaCat: 'Unspecified' };
      let str = String(area).trim();
      const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
      for (let i = 0; i < 10; i++) {
        str = str.split(arabicDigits[i]).join(i);
      }
      str = str.replace(/(متر\\s*مربع|م2|م²|m2|sqm|sq\\.m)/gi, '').trim();
      const rangeMatch = str.match(/(\\d+)\\s*[-_–/to]+\\s*(\\d+)/i);
      if (rangeMatch) {
        const n1 = parseFloat(rangeMatch[1]);
        const n2 = parseFloat(rangeMatch[2]);
        const avg = (n1 + n2) / 2;
        let cat = 'Unspecified';
        if (avg < 150) cat = '< 150 m²';
        else if (avg <= 250) cat = '150 - 250 m²';
        else cat = '> 250 m²';
        return { areaNum: avg, areaCat: cat };
      }
      const numMatch = str.match(/(\\d+(\\.\\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        let cat = 'Unspecified';
        if (num > 0 && num < 150) cat = '< 150 m²';
        else if (num >= 150 && num <= 250) cat = '150 - 250 m²';
        else if (num > 250) cat = '> 250 m²';
        return { areaNum: num, areaCat: cat };
      }
      return { areaNum: 0, areaCat: 'Unspecified' };
    }

    function parseDateStr(dt) {
      if (!dt) return '';
      const m = String(dt).match(/(\\d{4}-\\d{2}-\\d{2})/);
      return m ? m[1] : '';
    }

    function extractHiddenRowsClient(headerRow) {
      const firstCol = (headerRow[0] || '').trim();
      const idsInFirstCol = (firstCol.match(/\\bl:\\d+/g) || []);
      if (idsInFirstCol.length === 0) return [];

      const splitByPrefix = (cell, prefix) => {
        if (!cell) return [];
        const re = new RegExp('\\\\b' + prefix + '\\\\d+', 'g');
        const matches = cell.match(re);
        if (!matches) return [];
        return matches.map(m => m.replace(prefix, '').trim());
      };

      const splitDates = (cell) => {
        if (!cell) return [];
        const matches = cell.match(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[+-]\\d{2}:\\d{2}/g);
        return matches || [];
      };

      const idCol = splitByPrefix(headerRow[0], 'l:');
      const createdCol = splitDates(headerRow[1]);
      const adIdCol = splitByPrefix(headerRow[2], 'ag:');
      const adsetIdCol = splitByPrefix(headerRow[4], 'as:');
      const campIdCol = splitByPrefix(headerRow[6], 'c:');

      const count = idCol.length;
      const recovered = [];
      for (let i = 0; i < count; i++) {
        const row = new Array(headerRow.length).fill('');
        row[0] = idCol[i] || '';
        row[1] = createdCol[i] || '';
        row[2] = adIdCol[i] || '';
        row[4] = adsetIdCol[i] || '';
        row[6] = campIdCol[i] || '';
        recovered.push(row);
      }
      return recovered;
    }

    // MAIN LIVE FETCH ENGINE
    async function fetchLiveGoogleData(manual = false) {
      const syncIcon = document.getElementById('syncIcon');
      if (syncIcon) syncIcon.classList.add('spin-animation');

      try {
        // Fetch Meta Spend first to have maps ready
        const metaAdMap = {};
        const metaAdsetMap = {};
        const metaCampMap = {};
        try {
          const metaUrl = \`https://docs.google.com/spreadsheets/d/\${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Meta_Spend_Daily\`;
          const metaResp = await fetch(metaUrl);
          if (metaResp.ok) {
            const metaCsv = await metaResp.text();
            const metaRows = parseCSV(metaCsv);
            if (metaRows && metaRows.length > 1) {
              const metaList = [];
              metaRows.slice(1).forEach(r => {
                if (r.every(c => !c || c.trim() === '')) return;
                const rawDate = cleanText(r[0]);
                const day = parseDateStr(rawDate) || rawDate;
                const campaignName = cleanText(r[1]) || 'General Campaign';
                let campaignId = cleanText(r[2]) || '';
                const adsetName = cleanText(r[3]) || 'General Ad Set';
                let adsetId = cleanText(r[4]) || '';
                const adName = cleanText(r[5]) || 'General Ad';
                let adId = cleanText(r[6]) || '';
                const spend = parseFloat(cleanText(r[7]).replace(/,/g, '')) || 0;
                const results = parseInt(cleanText(r[9])) || 0;

                // Match with CRM leads canonical IDs (exact, 13-digit prefix, or name)
                const cLead = ALL_LEADS.find(l => matchIdsOrNames(l.campaignId, l.campaignName, campaignId, campaignName));
                if (cLead && cLead.campaignId) campaignId = cLead.campaignId;

                const asLead = ALL_LEADS.find(l => matchIdsOrNames(l.adsetId, l.adsetName, adsetId, adsetName));
                if (asLead && asLead.adsetId) adsetId = asLead.adsetId;

                const aLead = ALL_LEADS.find(l => matchIdsOrNames(l.adId, l.adName, adId, adName));
                if (aLead && aLead.adId) adId = aLead.adId;

                if (adId && adName) metaAdMap[adId] = adName;
                if (adsetId && adsetName) metaAdsetMap[adsetId] = adsetName;
                if (campaignId && campaignName) metaCampMap[campaignId] = campaignName;

                if (day && (spend > 0 || results > 0)) {
                  metaList.push({ day, campaignName, campaignId, adsetName, adsetId, adName, adId, spend, results });
                }
              });
              if (metaList.length > 0) ALL_META_SPEND = metaList;
            }
          }
        } catch (metaErr) {
          console.warn('Error fetching Meta_Spend_Daily', metaErr);
        }

        const liveList = [];
        for (let tab of SHEET_TABS) {
          try {
            // Use export?format=csv&gid=GID — bypasses ALL Google Sheets UI filters
            const url = tab.gid
              ? \`https://docs.google.com/spreadsheets/d/\${GOOGLE_SHEET_ID}/export?format=csv&gid=\${tab.gid}\`
              : \`https://docs.google.com/spreadsheets/d/\${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=\${encodeURIComponent(tab.name)}\`;
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const csvText = await resp.text();
            const rows = parseCSV(csvText);
            if (!rows || rows.length <= 1) continue;

            const rawHeaders = rows[0];
            const headers = rawHeaders.map(h => {
              const clean = cleanText(h).toLowerCase().trim();
              return clean.split(/\\s+/)[0];
            });

            const idIdx = headers.findIndex(h => h === 'id');
            const createdIdx = headers.findIndex(h => h === 'created_time' || h === 'created' || h === 'create');
            const adIdIdx = headers.findIndex(h => h === 'ad_id');
            const adIdx = headers.findIndex(h => h === 'ad_name');
            const adsetIdIdx = headers.findIndex(h => h === 'adset_id');
            const adsetIdx = headers.findIndex(h => h === 'adset_name');
            const campIdIdx = headers.findIndex(h => h === 'campaign_id');
            const campIdx = headers.findIndex(h => h === 'campaign_name');
            const condIdx = headers.findIndex(h => h.includes('condition') || h.includes('حالة'));
            const areaIdx = headers.findIndex(h => h.includes('area') || h.includes('مساحة'));
            const locIdx = headers.findIndex(h => h.includes('unit_location') || h.includes('government') || h.includes('محافظة'));
            const nameIdx = headers.findIndex(h => h === 'full_name' || (h.includes('name') && !h.includes('ad') && !h.includes('campaign') && !h.includes('form') && !h.includes('set') && !h.includes('owner')));
            const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('هاتف') || h.includes('mobile'));
            const statusIdx = headers.findIndex(h => h === 'lead_status' || h === 'status');
            const notesIdx = headers.findIndex(h => h === 'note' || h === 'notes');
            const ownerIdx = headers.findIndex(h => h.includes('owner') || h.includes('agent') || h.includes('assign'));
            const meetingIdx = headers.findIndex(h => h.includes('scanning') || h.includes('meeting'));
            const dealIdx = headers.findIndex(h => h.includes('deal') || h.includes('تعاقد'));

            const hiddenRows = extractHiddenRowsClient(rawHeaders);
            const allRows = [...hiddenRows, ...rows.slice(1)];

            allRows.forEach((r) => {
              if (r.every(c => !c || c.trim() === '')) return;
              const id = idIdx !== -1 ? cleanText(r[idIdx]) : '';
              const name = nameIdx !== -1 ? cleanText(r[nameIdx]) : '';
              const phone = phoneIdx !== -1 ? cleanText(r[phoneIdx]) : '';
              const rawCreated = createdIdx !== -1 ? cleanText(r[createdIdx]) : '';
              let adId = adIdIdx !== -1 ? cleanText(r[adIdIdx]) : '';
              let adName = adIdx !== -1 ? cleanText(r[adIdx]) : '';
              let adsetId = adsetIdIdx !== -1 ? cleanText(r[adsetIdIdx]) : '';
              let adsetName = adsetIdx !== -1 ? cleanText(r[adsetIdx]) : '';
              let campaignId = campIdIdx !== -1 ? cleanText(r[campIdIdx]) : '';
              let campaignName = campIdx !== -1 ? cleanText(r[campIdx]) : '';

              if (!adName && adId && metaAdMap[adId]) adName = metaAdMap[adId];
              if (!adsetName && adsetId && metaAdsetMap[adsetId]) adsetName = metaAdsetMap[adsetId];
              if (!campaignName && campaignId && metaCampMap[campaignId]) campaignName = metaCampMap[campaignId];

              if (!adName) adName = 'General Ad';
              if (!campaignName) campaignName = (tab.name === 'Sheet25' || tab.name === 'Form 1/9/2026-copy' || tab.name === 'Form 7-9-2026') ? 'Cost Plus Campaign' : (tab.name === 'Sheet26' ? 'Expatriates Campaign' : 'Your Time is Precious');

              const cond = condIdx !== -1 ? cleanCondition(cleanText(r[condIdx])) : 'Unspecified';
              const areaInfo = areaIdx !== -1 ? parseArea(cleanText(r[areaIdx])) : { areaNum: 0, areaCat: 'Unspecified' };
              const loc = locIdx !== -1 ? cleanText(r[locIdx]) : 'القاهرة / الجيزة';
              const status = statusIdx !== -1 ? cleanText(r[statusIdx]) : 'No Answer';
              const notes = notesIdx !== -1 ? cleanText(r[notesIdx]) : '-';
              
              let owner = ownerIdx !== -1 ? cleanText(r[ownerIdx]) : 'Unassigned';
              if (owner.includes('|') || owner.includes('Lead Form')) owner = 'Unassigned';

              const dateFormatted = parseDateStr(rawCreated);
              const meetingDate = meetingIdx !== -1 ? parseDateStr(cleanText(r[meetingIdx])) : '';
              const dealDate = dealIdx !== -1 ? parseDateStr(cleanText(r[dealIdx])) : '';
              const country = phone.startsWith('+966') || phone.startsWith('966') ? 'KSA (السعودية)' : (phone.startsWith('+20') || phone.startsWith('20') || phone.startsWith('01') ? 'Egypt (مصر)' : 'Gulf / Other');

              liveList.push({
                id,
                name: name || 'عميل',
                phone: phone || '-',
                country,
                date: dateFormatted || getTodayISO(),
                rawCreated,
                adId,
                adName,
                adsetId,
                adsetName,
                campaignId,
                campaignName,
                areaNum: areaInfo.areaNum,
                areaCategory: areaInfo.areaCat,
                condition: cond,
                location: loc || 'القاهرة / الجيزة',
                status: status || 'No Answer',
                owner: owner || 'Unassigned',
                notes: notes || '-',
                meetingDate,
                dealDate,
                sheetSource: tab.name
              });
            });
          } catch (tabErr) {
            console.warn('Error fetching leads tab', tab.name, tabErr);
          }
        }

        if (liveList.length > 0) {
          ALL_LEADS = liveList.sort((a, b) => (a.date > b.date ? 1 : -1));
        }

        initDateControls();
        init3TierMetaFilters();

        if (currentView === 'LEADS') applyLeadsFilters();
        else if (currentView === 'CAMPAIGNS') applyCampFilters();
        updateHubCounters();

        const now = new Date();
        const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('lastSyncTime').innerText = \`🟢 متصل ومحدث مباشرة من Google Sheets (\${ALL_LEADS.length} ليد - \${timeStr})\`;
      } catch (e) {
        console.error('Fetch error:', e);
        document.getElementById('lastSyncTime').innerText = '⚠️ تعذر الاتصال بـ Google Sheets، جاري المحاولة مجدداً...';
      } finally {
        if (syncIcon) syncIcon.classList.remove('spin-animation');
      }
    }

    setInterval(() => {
      if (sessionStorage.getItem('amlaak_auth') === 'true') {
        fetchLiveGoogleData();
      }
    }, 60000);

    function initDateControls() {
      document.getElementById('startDateInput').value = leadsStartDate;
      document.getElementById('endDateInput').value = leadsEndDate;
      document.getElementById('campStartDateInput').value = campStartDate;
      document.getElementById('campEndDateInput').value = campEndDate;
    }

    // 3-TIER CASCADING FILTERS (Campaign -> Ad Set -> Ad)
    function init3TierMetaFilters() {
      const campSelect = document.getElementById('metaCampaignSelectFilter');
      const adsetSelect = document.getElementById('metaAdsetSelectFilter');
      const adSelect = document.getElementById('metaAdSelectFilter');

      // 1. Campaigns map
      const campMap = {};
      ALL_META_SPEND.forEach(s => {
        if (s.campaignId && s.campaignName) campMap[s.campaignId] = s.campaignName;
      });
      let campHtml = '<option value="ALL">🌐 كل الحملات الإعلانية (All Campaigns)</option>';
      Object.entries(campMap).forEach(([id, name]) => {
        campHtml += \`<option value="\${id}">\${name}</option>\`;
      });
      campSelect.innerHTML = campHtml;
      campSelect.value = selectedCampaignId;

      // 2. Ad Sets based on campaign
      let adsetDataset = ALL_META_SPEND;
      if (selectedCampaignId !== 'ALL') {
        adsetDataset = adsetDataset.filter(s => s.campaignId === selectedCampaignId);
      }
      const adsetMap = {};
      adsetDataset.forEach(s => {
        if (s.adsetId && s.adsetName) adsetMap[s.adsetId] = s.adsetName;
      });
      let adsetHtml = '<option value="ALL">📁 كل المجموعات الإعلانية (All Ad Sets)</option>';
      Object.entries(adsetMap).forEach(([id, name]) => {
        adsetHtml += \`<option value="\${id}">\${name}</option>\`;
      });
      adsetSelect.innerHTML = adsetHtml;
      adsetSelect.value = adsetMap[selectedAdsetId] ? selectedAdsetId : 'ALL';
      if (!adsetMap[selectedAdsetId]) selectedAdsetId = 'ALL';

      // 3. Ads based on campaign & adset
      let adDataset = adsetDataset;
      if (selectedAdsetId !== 'ALL') {
        adDataset = adDataset.filter(s => s.adsetId === selectedAdsetId);
      }
      const adMap = {};
      adDataset.forEach(s => {
        if (s.adId && s.adName) adMap[s.adId] = s.adName;
      });
      let adHtml = '<option value="ALL">🎬 كل الإعلانات والكرييتف (All Ads)</option>';
      Object.entries(adMap).forEach(([id, name]) => {
        adHtml += \`<option value="\${id}">\${name}</option>\`;
      });
      adSelect.innerHTML = adHtml;
      adSelect.value = adMap[selectedAdId] ? selectedAdId : 'ALL';
      if (!adMap[selectedAdId]) selectedAdId = 'ALL';

      updateActiveFilterNotice();
    }

    function handleCampaignFilterChange(val, autoSwitchTab = true) {
      selectedCampaignId = val;
      selectedAdsetId = 'ALL';
      selectedAdId = 'ALL';
      init3TierMetaFilters();
      if (autoSwitchTab) {
        if (val !== 'ALL') setBreakdownTab('ADSETS');
        else setBreakdownTab('CAMPAIGNS');
      } else {
        applyCampFilters();
      }
    }

    function handleAdsetFilterChange(val, autoSwitchTab = true) {
      selectedAdsetId = val;
      selectedAdId = 'ALL';
      init3TierMetaFilters();
      if (autoSwitchTab) {
        if (val !== 'ALL') setBreakdownTab('ADS');
        else setBreakdownTab('ADSETS');
      } else {
        applyCampFilters();
      }
    }

    function handleAdFilterChange(val) {
      selectedAdId = val;
      updateActiveFilterNotice();
      applyCampFilters();
    }

    function resetMetaDropdownFilters() {
      selectedCampaignId = 'ALL';
      selectedAdsetId = 'ALL';
      selectedAdId = 'ALL';
      init3TierMetaFilters();
      setBreakdownTab('CAMPAIGNS');
    }

    function updateActiveFilterNotice() {
      const notice = document.getElementById('activeFilterNotice');
      const label = document.getElementById('activeFilterLabel');
      
      const activeParts = [];
      if (selectedCampaignId !== 'ALL') {
        const c = ALL_META_SPEND.find(s => s.campaignId === selectedCampaignId);
        if (c) activeParts.push(\`<span class="cursor-pointer hover:underline text-blue-300" onclick="setBreakdownTab('ADSETS')"><i class="fa-solid fa-bullhorn text-blue-400"></i> \${c.campaignName}</span>\`);
      }
      if (selectedAdsetId !== 'ALL') {
        const as = ALL_META_SPEND.find(s => s.adsetId === selectedAdsetId);
        if (as) activeParts.push(\`<span class="cursor-pointer hover:underline text-purple-300" onclick="setBreakdownTab('ADS')"><i class="fa-solid fa-layer-group text-purple-400"></i> \${as.adsetName}</span>\`);
      }
      if (selectedAdId !== 'ALL') {
        const a = ALL_META_SPEND.find(s => s.adId === selectedAdId);
        if (a) activeParts.push(\`<span class="text-amber-300"><i class="fa-solid fa-rectangle-ad text-amber-400"></i> \${a.adName}</span>\`);
      }

      if (activeParts.length > 0) {
        notice.classList.remove('hidden');
        notice.classList.add('flex');
        label.innerHTML = activeParts.join(' <span class="text-slate-500 font-bold mx-1">➔</span> ');
      } else {
        notice.classList.add('hidden');
        notice.classList.remove('flex');
      }
    }

    // LEADS CRM LOGIC
    function handleLeadsDateChange() {
      leadsStartDate = document.getElementById('startDateInput').value || '2026-07-22';
      leadsEndDate = document.getElementById('endDateInput').value || getTodayISO();
      applyLeadsFilters();
    }

    function setLeadsDatePreset(preset) {
      const todayISO = getTodayISO();
      if (preset === 'ALL') {
        leadsStartDate = '2026-07-22';
        leadsEndDate = todayISO;
      } else if (preset === 'JULY') {
        leadsStartDate = '2026-07-22';
        leadsEndDate = '2026-07-31';
      } else if (preset === 'AUG') {
        leadsStartDate = '2026-08-01';
        leadsEndDate = todayISO.startsWith('2026-08') ? todayISO : '2026-08-31';
      } else if (preset === 'LAST7') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        leadsStartDate = d.toISOString().slice(0, 10);
        leadsEndDate = todayISO;
      }
      document.getElementById('startDateInput').value = leadsStartDate;
      document.getElementById('endDateInput').value = leadsEndDate;
      applyLeadsFilters();
    }

    function toggleQuickFilter(type) {
      if (quickFilterState === type) {
        quickFilterState = null;
        document.getElementById('btnQuickQual').className = 'py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickMid').className = 'py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickKsa').className = 'py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickMeeting').className = 'py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
      } else {
        quickFilterState = type;
        document.getElementById('btnQuickQual').className = 'py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickMid').className = 'py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickKsa').className = 'py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';
        document.getElementById('btnQuickMeeting').className = 'py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm';

        if (type === 'QUALIFIED') document.getElementById('btnQuickQual').className = 'py-2 rounded-xl bg-emerald-600 text-white font-black text-[11px] flex items-center justify-center gap-1 shadow-md';
        else if (type === 'MID_AREA') document.getElementById('btnQuickMid').className = 'py-2 rounded-xl bg-[#c5a059] text-[#0b192c] font-black text-[11px] flex items-center justify-center gap-1 shadow-md';
        else if (type === 'KSA') document.getElementById('btnQuickKsa').className = 'py-2 rounded-xl bg-purple-600 text-white font-black text-[11px] flex items-center justify-center gap-1 shadow-md';
        else if (type === 'MEETING') document.getElementById('btnQuickMeeting').className = 'py-2 rounded-xl bg-cyan-600 text-white font-black text-[11px] flex items-center justify-center gap-1 shadow-md';
      }
      applyLeadsFilters();
    }

    function handleAreaSlider(val) {
      maxArea = parseInt(val);
      document.getElementById('sliderDisplay').innerText = 'Up to ' + val + ' m²';
      applyLeadsFilters();
    }

    function applyLeadsFilters() {
      const st = document.getElementById('statusFilter').value;
      const ow = document.getElementById('ownerFilter').value;
      const cond = document.getElementById('conditionFilter').value;
      const cntry = document.getElementById('countryFilter').value;
      const search = (document.getElementById('leadsSearchInput').value || '').toLowerCase().trim();

      filteredLeads = ALL_LEADS.filter(l => {
        if (quickFilterState === 'QUALIFIED' && l.status !== 'Qualified') return false;
        if (quickFilterState === 'MID_AREA' && (!l.areaCategory || !l.areaCategory.includes('150 - 250') && !l.areaCategory.includes('150-250'))) return false;
        if (quickFilterState === 'KSA' && (!l.country || !l.country.includes('KSA') && !l.country.includes('السعودية'))) return false;
        if (quickFilterState === 'MEETING' && (!l.meetingDate || l.meetingDate.trim() === '')) return false;

        if (l.date && (l.date < leadsStartDate || l.date > leadsEndDate)) return false;
        if (maxArea < 500 && l.areaNum > 0 && l.areaNum > maxArea) return false;
        if (st !== 'ALL' && l.status !== st) return false;
        if (ow !== 'ALL' && !l.owner.toLowerCase().includes(ow.toLowerCase())) return false;
        if (cond !== 'ALL' && (!l.condition || !l.condition.toLowerCase().includes(cond.toLowerCase()))) return false;
        if (cntry !== 'ALL' && (!l.country || !l.country.toLowerCase().includes(cntry.toLowerCase()))) return false;

        if (search) {
          const matchName = l.name.toLowerCase().includes(search);
          const matchPhone = l.phone.includes(search);
          const matchLoc = l.location.toLowerCase().includes(search);
          const matchNotes = l.notes.toLowerCase().includes(search);
          if (!matchName && !matchPhone && !matchLoc && !matchNotes) return false;
        }
        return true;
      });

      updateLeadsKPIs();
      renderLeadsCharts();
      renderLeadsTable();
    }

    function updateLeadsKPIs() {
      const total = filteredLeads.length;
      const qual = filteredLeads.filter(l => l.status === 'Qualified').length;
      const mid = filteredLeads.filter(l => l.areaCategory && (l.areaCategory.includes('150 - 250') || l.areaCategory.includes('150-250'))).length;
      const ksa = filteredLeads.filter(l => l.country && (l.country.includes('KSA') || l.country.includes('السعودية'))).length;
      const meetings = filteredLeads.filter(l => l.meetingDate && l.meetingDate.trim() !== '').length;
      const deals = filteredLeads.filter(l => l.dealDate && l.dealDate.trim() !== '').length;

      document.getElementById('kpiTotalLeads').innerText = total;
      document.getElementById('kpiQualified').innerText = qual;
      document.getElementById('kpiQualRate').innerText = total > 0 ? ((qual / total) * 100).toFixed(1) + '% Rate' : '0%';
      document.getElementById('kpiMidArea').innerText = mid;
      document.getElementById('kpiKsa').innerText = ksa;
      document.getElementById('kpiMeetings').innerText = meetings;
      document.getElementById('kpiDeals').innerText = deals;
    }

    function renderLeadsCharts() {
      const isMobile = window.innerWidth < 640;

      // 1. Timeline Chart
      const dateMap = {};
      filteredLeads.forEach(l => {
        if (!l.date) return;
        dateMap[l.date] = (dateMap[l.date] || 0) + 1;
      });
      const sortedDates = Object.keys(dateMap).sort();
      const tOpts = {
        series: [{ name: 'Incoming Leads', data: sortedDates.map(d => dateMap[d]) }],
        chart: { type: 'area', height: isMobile ? 220 : 250, toolbar: { show: false }, background: 'transparent' },
        colors: ['#c5a059'],
        stroke: { curve: 'smooth', width: 2.5 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
        dataLabels: { enabled: false },
        xaxis: { categories: sortedDates, labels: { style: { colors: '#94a3b8', fontSize: '10px' } } },
        yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '10px' } } },
        grid: { borderColor: '#1e293b' },
        theme: { mode: 'dark' }
      };
      if (chartTimeline) chartTimeline.destroy();
      chartTimeline = new ApexCharts(document.querySelector("#chartTimeline"), tOpts);
      chartTimeline.render();

      // 2. Qualification Donut
      const qual = filteredLeads.filter(l => l.status === 'Qualified').length;
      const notQual = filteredLeads.filter(l => l.status === 'Not Qualified').length;
      const noAns = filteredLeads.filter(l => l.status === 'No Answer').length;
      const created = filteredLeads.filter(l => l.status === 'CREATED').length;
      const qOpts = {
        series: [qual, notQual, noAns, created],
        labels: ['Qualified', 'Not Qualified', 'No Answer', 'CREATED'],
        colors: ['#10b981', '#f43f5e', '#64748b', '#06b6d4'],
        chart: { type: 'donut', height: isMobile ? 220 : 250 },
        legend: { position: 'bottom', labels: { colors: '#cbd5e1' } },
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 800, colors: ['#ffffff'] } }
      };
      if (chartQualification) chartQualification.destroy();
      chartQualification = new ApexCharts(document.querySelector("#chartQualification"), qOpts);
      chartQualification.render();

      // 3. Area Distribution Bar
      const areaCounts = { '< 150 m²': 0, '150 - 250 m²': 0, '> 250 m²': 0 };
      filteredLeads.forEach(l => {
        if (!l.areaCategory) return;
        if (l.areaCategory.includes('150 - 250') || l.areaCategory.includes('150-250')) areaCounts['150 - 250 m²']++;
        else if (l.areaCategory.includes('< 150') || l.areaCategory.includes('أقل من 150')) areaCounts['< 150 m²']++;
        else if (l.areaCategory.includes('> 250') || l.areaCategory.includes('أكبر من 250')) areaCounts['> 250 m²']++;
      });
      const aOpts = {
        series: [{ name: 'Units', data: [areaCounts['< 150 m²'], areaCounts['150 - 250 m²'], areaCounts['> 250 m²']] }],
        chart: { type: 'bar', height: isMobile ? 200 : 220, toolbar: { show: false } },
        xaxis: { categories: ['< 150 m²', '150 - 250 m²', '> 250 m²'], labels: { style: { colors: '#94a3b8', fontSize: '10px' } } },
        colors: ['#c5a059'],
        plotOptions: { bar: { borderRadius: 6, dataLabels: { position: 'top' } } },
        dataLabels: { enabled: true, offsetY: -18, style: { fontSize: '11px', fontWeight: 900, colors: ['#ffffff'] } },
        grid: { borderColor: '#1e293b' }
      };
      if (chartArea) chartArea.destroy();
      chartArea = new ApexCharts(document.querySelector("#chartArea"), aOpts);
      chartArea.render();

      // 4. Geo Demand Bar
      const lCounts = {};
      filteredLeads.forEach(l => { lCounts[l.location] = (lCounts[l.location] || 0) + 1; });
      const topL = Object.entries(lCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      const lOpts = {
        series: [{ name: 'Leads', data: topL.map(x => x[1]) }],
        xaxis: { categories: topL.map(x => x[0]), labels: { style: { colors: '#94a3b8', fontSize: '10px' } } },
        colors: ['#38bdf8'],
        chart: { type: 'bar', height: isMobile ? 200 : 220, toolbar: { show: false } },
        plotOptions: { bar: { horizontal: true, borderRadius: 6, dataLabels: { position: 'inside' } } },
        dataLabels: { enabled: true, formatter: val => val + ' Leads', textAnchor: 'middle', style: { fontSize: '11px', fontWeight: 900, colors: ['#ffffff'] } },
        grid: { borderColor: '#1e293b' }
      };
      if (chartLocation) chartLocation.destroy();
      chartLocation = new ApexCharts(document.querySelector("#chartLocation"), lOpts);
      chartLocation.render();

      // 5. Unit Condition Bar
      const cCounts = { 'Semi-Finished': 0, 'Core & Shell': 0, 'Fully Finished': 0 };
      filteredLeads.forEach(l => {
        if (l.condition && (l.condition.includes('Semi') || l.condition.includes('نصف تشطيب'))) cCounts['Semi-Finished']++;
        else if (l.condition && (l.condition.includes('Core') || l.condition.includes('طوب أحمر'))) cCounts['Core & Shell']++;
        else if (l.condition && (l.condition.includes('Finished') || l.condition.includes('متشطبة'))) cCounts['Fully Finished']++;
      });
      const cOpts = {
        series: [{
          name: 'Units',
          data: [
            { x: 'Semi-Finished (نصف تشطيب)', y: cCounts['Semi-Finished'], fillColor: '#10b981' },
            { x: 'Core & Shell (طوب أحمر)', y: cCounts['Core & Shell'], fillColor: '#f59e0b' },
            { x: 'Fully Finished (متشطبة)', y: cCounts['Fully Finished'], fillColor: '#8b5cf6' }
          ]
        }],
        chart: { type: 'bar', height: isMobile ? 200 : 220, toolbar: { show: false } },
        plotOptions: { bar: { horizontal: true, borderRadius: 6, dataLabels: { position: 'inside' } } },
        dataLabels: { enabled: true, formatter: val => val + ' Units', textAnchor: 'middle', style: { fontSize: '11px', fontWeight: 900, colors: ['#ffffff'] } },
        grid: { borderColor: '#1e293b' }
      };
      if (chartCondition) chartCondition.destroy();
      chartCondition = new ApexCharts(document.querySelector("#chartCondition"), cOpts);
      chartCondition.render();
    }

    function renderLeadsTable() {
      const tbody = document.getElementById('leadsTableBody');
      tbody.innerHTML = '';
      
      const sorted = [...filteredLeads].sort((a, b) => (b.rawCreated || b.date || '').localeCompare(a.rawCreated || a.date || ''));

      sorted.slice(0, 150).forEach((l, i) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-800/50 active:bg-slate-800 transition border-b border-slate-800/60';
        let badge = '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">No Answer</span>';
        if (l.status === 'Qualified') badge = '<span class="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black font-mono">Qualified ✅</span>';
        if (l.status === 'Not Qualified') badge = '<span class="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-bold font-mono">Not Qual ❌</span>';
        if (l.status === 'CREATED') badge = '<span class="px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 text-[10px] font-bold font-mono">CREATED 🆕</span>';

        let agentBadge = '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium text-[10px]">Unassigned</span>';
        if (l.owner.toLowerCase().includes('mariam') || l.owner.includes('مريم')) {
          agentBadge = '<span class="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold text-[11px]">Mariam</span>';
        } else if (l.owner.toLowerCase().includes('shahd') || l.owner.includes('شهد')) {
          agentBadge = '<span class="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-[11px]">Shahd</span>';
        }

        const cleanP = l.phone.replace(/[^\\d+]/g, '');
        const wa = 'https://wa.me/' + cleanP.replace('+', '');

        tr.innerHTML = \`
          <td class="p-2.5 sm:p-3 text-slate-500 font-mono">\${i + 1}</td>
          <td class="p-2.5 sm:p-3 font-mono text-amber-300/90 text-[11px]">\${l.date || '-'}</td>
          <td class="p-2.5 sm:p-3 font-bold text-white text-[11px] sm:text-xs">\${l.name}</td>
          <td class="p-2.5 sm:p-3 font-mono text-slate-300 text-[11px]" dir="ltr">\${l.phone}</td>
          <td class="p-2.5 sm:p-3"><span class="px-2 py-0.5 rounded bg-[#0b192c] text-[#c5a059] font-bold text-[10px]">\${l.country}</span></td>
          <td class="p-2.5 sm:p-3 font-bold text-amber-200 text-[11px] font-mono">\${l.areaNum ? l.areaNum + ' m²' : '-'}</td>
          <td class="p-2.5 sm:p-3 text-slate-300 text-[11px]">\${l.condition}</td>
          <td class="p-2.5 sm:p-3 text-slate-300 text-[11px]">\${l.location}</td>
          <td class="p-2.5 sm:p-3 text-slate-300 text-[10px] font-semibold max-w-[110px] truncate font-mono" title="\${l.adName}">\${l.adName}</td>
          <td class="p-2.5 sm:p-3">\${badge}</td>
          <td class="p-2.5 sm:p-3 font-mono text-cyan-300 font-bold text-[10px]">\${l.meetingDate || '-'}</td>
          <td class="p-2.5 sm:p-3 font-mono text-emerald-400 font-bold text-[10px]">\${l.dealDate || '-'}</td>
          <td class="p-2.5 sm:p-3">\${agentBadge}</td>
          <td class="p-2.5 sm:p-3 text-slate-300 max-w-xs truncate font-medium text-[11px]" title="\${l.notes}">\${l.notes}</td>
          <td class="p-2.5 sm:p-3 text-center">
            <a href="\${wa}" target="_blank" class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white active:scale-90 transition shadow-sm" title="Direct WhatsApp Chat">
              <i class="fa-brands fa-whatsapp text-base"></i>
            </a>
          </td>
        \`;
        tbody.appendChild(tr);
      });
      document.getElementById('leadsRecordCount').innerText = \`Showing \${filteredLeads.length} of \${ALL_LEADS.length} Leads (Live Master)\`;
    }

    // META CAMPAIGNS LOGIC
    function handleCampDateChange() {
      campStartDate = document.getElementById('campStartDateInput').value || '2026-07-22';
      campEndDate = document.getElementById('campEndDateInput').value || getTodayISO();
      applyCampFilters();
    }

    function setCampDatePreset(preset) {
      const todayISO = getTodayISO();
      if (preset === 'ALL') {
        campStartDate = '2026-07-22';
        campEndDate = todayISO;
      } else if (preset === 'JULY') {
        campStartDate = '2026-07-22';
        campEndDate = '2026-07-31';
      } else if (preset === 'AUG') {
        campStartDate = '2026-08-01';
        campEndDate = todayISO.startsWith('2026-08') ? todayISO : '2026-08-31';
      } else if (preset === 'SEPT') {
        campStartDate = '2026-09-01';
        campEndDate = todayISO;
      } else if (preset === 'LAST7') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        campStartDate = d.toISOString().slice(0, 10);
        campEndDate = todayISO;
      }
      document.getElementById('campStartDateInput').value = campStartDate;
      document.getElementById('campEndDateInput').value = campEndDate;
      applyCampFilters();
    }

    function setGranularity(gran) {
      campGranularity = gran;
      ['btnGranDaily', 'btnGranWeekly', 'btnGranMonthly'].forEach(id => {
        document.getElementById(id).className = 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-bold text-[11px] transition';
      });
      if (gran === 'DAILY') document.getElementById('btnGranDaily').className = 'px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] transition';
      if (gran === 'WEEKLY') document.getElementById('btnGranWeekly').className = 'px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] transition';
      if (gran === 'MONTHLY') document.getElementById('btnGranMonthly').className = 'px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] transition';
      renderMetaTrendChart();
    }

    function setBreakdownTab(tab) {
      campBreakdownTab = tab;
      ['tabBtnCampaigns', 'tabBtnAdsets', 'tabBtnAds'].forEach(id => {
        document.getElementById(id).className = 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-white font-bold text-xs transition';
      });
      if (tab === 'CAMPAIGNS') document.getElementById('tabBtnCampaigns').className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs transition';
      if (tab === 'ADSETS') document.getElementById('tabBtnAdsets').className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs transition';
      if (tab === 'ADS') document.getElementById('tabBtnAds').className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs transition';
      applyCampFilters();
    }

    function drilldownToCampaign(cId) {
      handleCampaignFilterChange(cId, true);
    }

    function drilldownToAdset(asId) {
      handleAdsetFilterChange(asId, true);
    }

    function applyCampFilters() {
      // 1. Filter Meta Spend by Dates and Exact IDs
      filteredSpend = ALL_META_SPEND.filter(s => {
        if (s.day < campStartDate || s.day > campEndDate) return false;
        if (selectedCampaignId !== 'ALL' && s.campaignId !== selectedCampaignId) return false;
        if (selectedAdsetId !== 'ALL' && s.adsetId !== selectedAdsetId) return false;
        if (selectedAdId !== 'ALL' && s.adId !== selectedAdId) return false;
        return true;
      });

      updateMetaKPIs();
      renderMetaTrendChart();
      renderBreakdownTable();
    }

    function updateMetaKPIs() {
      const totalSpend = filteredSpend.reduce((acc, row) => acc + (row.spend || 0), 0);
      const totalMetaLeads = filteredSpend.reduce((acc, row) => acc + (row.results || 0), 0);

      // EXACT ID LINKAGE
      const leadsInRange = ALL_LEADS.filter(l => {
        if (l.date && (l.date < campStartDate || l.date > campEndDate)) return false;
        if (selectedCampaignId !== 'ALL') {
          const matchCamp = l.campaignId === selectedCampaignId ||
                            (l.campaignId && selectedCampaignId && l.campaignId.length >= 13 && selectedCampaignId.length >= 13 && l.campaignId.slice(0, 13) === selectedCampaignId.slice(0, 13));
          if (!matchCamp) return false;
        }
        if (selectedAdsetId !== 'ALL') {
          const matchAdset = l.adsetId === selectedAdsetId ||
                             (l.adsetId && selectedAdsetId && l.adsetId.length >= 13 && selectedAdsetId.length >= 13 && l.adsetId.slice(0, 13) === selectedAdsetId.slice(0, 13));
          if (!matchAdset) return false;
        }
        if (selectedAdId !== 'ALL') {
          const matchAd = l.adId === selectedAdId ||
                          (l.adId && selectedAdId && l.adId.length >= 13 && selectedAdId.length >= 13 && l.adId.slice(0, 13) === selectedAdId.slice(0, 13));
          if (!matchAd) return false;
        }
        return true;
      });

      const crmLeadsCount = leadsInRange.length || 0;
      const qualifiedCount = leadsInRange.filter(l => l.status === 'Qualified').length;
      
      const meetingsCount = leadsInRange.filter(l => l.meetingDate && l.meetingDate.trim() !== '').length;
      const dealsCount = leadsInRange.filter(l => l.dealDate && l.dealDate.trim() !== '').length;

      const cpl = crmLeadsCount > 0 ? (totalSpend / crmLeadsCount) : 0;
      const cpql = qualifiedCount > 0 ? (totalSpend / qualifiedCount) : 0;
      const cpm = meetingsCount > 0 ? (totalSpend / meetingsCount) : 0;
      const cpa = dealsCount > 0 ? (totalSpend / dealsCount) : 0;
      const qualRate = crmLeadsCount > 0 ? ((qualifiedCount / crmLeadsCount) * 100) : 0;
      const discrepancy = totalMetaLeads > 0 ? (((totalMetaLeads - crmLeadsCount) / totalMetaLeads) * 100) : 0;

      document.getElementById('metaKpiSpend').innerText = totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EGP';
      document.getElementById('metaKpiCPL').innerText = cpl.toFixed(2) + ' EGP';
      document.getElementById('metaKpiLeadsCount').innerText = \`\${crmLeadsCount} CRM Leads\`;

      document.getElementById('metaKpiCPQL').innerText = cpql.toFixed(2) + ' EGP';
      document.getElementById('metaKpiQualRate').innerText = \`\${qualRate.toFixed(1)}% Qualified (\${qualifiedCount})\`;

      document.getElementById('metaKpiCPM').innerText = cpm > 0 ? cpm.toFixed(2) + ' EGP' : '0.00 EGP';
      document.getElementById('metaKpiMeetingsCount').innerText = \`\${meetingsCount} Conducted Scanning\`;

      document.getElementById('metaKpiCPA').innerText = cpa > 0 ? cpa.toFixed(2) + ' EGP' : '0.00 EGP';
      document.getElementById('metaKpiDealsCount').innerText = \`\${dealsCount} Signed Deals\`;
    }

    function renderMetaTrendChart() {
      const spendMap = {};
      const leadsMap = {};
      const qualMap = {};

      filteredSpend.forEach(s => {
        let key = s.day;
        if (campGranularity === 'WEEKLY') {
          const dt = new Date(s.day);
          const oneJan = new Date(dt.getFullYear(), 0, 1);
          const numberOfDays = Math.floor((dt - oneJan) / (24 * 60 * 60 * 1000));
          const week = Math.ceil((dt.getDay() + 1 + numberOfDays) / 7);
          key = \`W\${week} (\${dt.getFullYear()})\`;
        } else if (campGranularity === 'MONTHLY') {
          key = s.day.slice(0, 7);
        }
        spendMap[key] = (spendMap[key] || 0) + (s.spend || 0);
      });

      const leadsInRange = ALL_LEADS.filter(l => {
        if (l.date && (l.date < campStartDate || l.date > campEndDate)) return false;
        if (selectedCampaignId !== 'ALL' && l.campaignId !== selectedCampaignId) return false;
        if (selectedAdsetId !== 'ALL' && l.adsetId !== selectedAdsetId) return false;
        if (selectedAdId !== 'ALL' && l.adId !== selectedAdId) return false;
        return true;
      });

      leadsInRange.forEach(l => {
        let key = l.date;
        if (campGranularity === 'WEEKLY') {
          const dt = new Date(l.date);
          const oneJan = new Date(dt.getFullYear(), 0, 1);
          const numberOfDays = Math.floor((dt - oneJan) / (24 * 60 * 60 * 1000));
          const week = Math.ceil((dt.getDay() + 1 + numberOfDays) / 7);
          key = \`W\${week} (\${dt.getFullYear()})\`;
        } else if (campGranularity === 'MONTHLY') {
          key = l.date.slice(0, 7);
        }
        leadsMap[key] = (leadsMap[key] || 0) + 1;
        if (l.status === 'Qualified') {
          qualMap[key] = (qualMap[key] || 0) + 1;
        }
      });

      const allKeys = Array.from(new Set([...Object.keys(spendMap), ...Object.keys(leadsMap)])).sort();
      const isMobile = window.innerWidth < 640;
      const opts = {
        series: [
          { name: 'Spend (EGP)', type: 'column', data: allKeys.map(k => parseFloat((spendMap[k] || 0).toFixed(2))) },
          { name: 'CRM Leads', type: 'line', data: allKeys.map(k => leadsMap[k] || 0) },
          { name: 'Qualified Leads', type: 'line', data: allKeys.map(k => qualMap[k] || 0) }
        ],
        chart: {
          height: isMobile ? 260 : 320,
          type: 'line',
          toolbar: { show: false },
          background: 'transparent'
        },
        stroke: { width: [0, 3, 3], curve: 'smooth' },
        colors: ['#3b82f6', '#10b981', '#f59e0b'],
        plotOptions: { bar: { columnWidth: '45%', borderRadius: 4 } },
        xaxis: { categories: allKeys, labels: { style: { colors: '#94a3b8', fontSize: '10px' } } },
        yaxis: [
          {
            title: { text: 'Spend (EGP)', style: { color: '#3b82f6', fontSize: '11px' } },
            labels: { style: { colors: '#94a3b8', fontSize: '10px' } }
          },
          {
            opposite: true,
            title: { text: 'Leads Count', style: { color: '#10b981', fontSize: '11px' } },
            labels: { style: { colors: '#94a3b8', fontSize: '10px' } }
          }
        ],
        grid: { borderColor: '#1e293b' },
        theme: { mode: 'dark' },
        legend: { show: false }
      };

      if (chartMetaTrend) chartMetaTrend.destroy();
      chartMetaTrend = new ApexCharts(document.querySelector("#chartMetaTrend"), opts);
      chartMetaTrend.render();
    }

    // BREAKDOWN SORT & COMPARE HELPERS
    function toggleBreakdownSort(col) {
      if (breakdownSortCol === col) {
        breakdownSortDir = breakdownSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        breakdownSortCol = col;
        breakdownSortDir = 'desc';
      }
      renderBreakdownTable();
    }

    function sortBreakdown(rows) {
      const col = breakdownSortCol;
      const dir = breakdownSortDir;
      return [...rows].sort((a, b) => {
        const va = typeof a[col] === 'string' ? a[col].toLowerCase() : (a[col] ?? 0);
        const vb = typeof b[col] === 'string' ? b[col].toLowerCase() : (b[col] ?? 0);
        if (dir === 'asc') return va > vb ? 1 : va < vb ? -1 : 0;
        return va < vb ? 1 : va > vb ? -1 : 0;
      });
    }

    function makeThSort(col, label) {
      const isActive = breakdownSortCol === col;
      const arrow = isActive ? (breakdownSortDir === 'desc' ? ' ▼' : ' ▲') : ' ⬆⬇';
      const cls = isActive ? 'text-amber-400 font-black' : 'text-slate-400 hover:text-white';
      return \`<th class="p-3 cursor-pointer select-none transition \${cls} text-left whitespace-nowrap" onclick="toggleBreakdownSort('\${col}')">\${label}\${arrow}</th>\`;
    }

    function getQualRateColor(rate) {
      if (rate >= 25) return 'text-emerald-400 font-black';
      if (rate >= 15) return 'text-amber-400 font-bold';
      if (rate >= 5) return 'text-orange-400 font-bold';
      return 'text-rose-400 font-bold';
    }

    function toggleBreakdownRow(id, rowData) {
      if (selectedBreakdownRows[id]) {
        delete selectedBreakdownRows[id];
      } else {
        if (Object.keys(selectedBreakdownRows).length >= 4) return;
        selectedBreakdownRows[id] = rowData;
      }
      updateBreakdownComparePanel();
      renderBreakdownTable();
    }

    function clearBreakdownSelection() {
      selectedBreakdownRows = {};
      updateBreakdownComparePanel();
      renderBreakdownTable();
    }

    function updateBreakdownComparePanel() {
      const panel = document.getElementById('breakdownComparePanel');
      const rows = Object.values(selectedBreakdownRows);
      if (rows.length < 2) { panel.classList.add('hidden'); return; }
      panel.classList.remove('hidden');

      const metrics = [
        { key: 'spend',    label: 'Spend (الصرف)',   fmt: v => v.toLocaleString('en-US', {minimumFractionDigits:2}) + ' EGP', color: 'text-blue-300' },
        { key: 'crmLeads', label: 'CRM Leads',       fmt: v => v,                                                             color: 'text-emerald-300' },
        { key: '_cpl',     label: 'CPL (تكلفة الليد)',fmt: v => v.toFixed(2) + ' EGP',                                        color: 'text-cyan-300' },
        { key: 'qual',     label: 'Qualified',       fmt: v => v,                                                             color: 'text-emerald-400' },
        { key: '_qr',      label: 'Qual Rate %',     fmt: v => v.toFixed(1) + '%',                                           color: 'text-amber-300' },
        { key: '_cpql',    label: 'CPQL (تكلفة المؤهل)',fmt: v => v.toFixed(2) + ' EGP',                                      color: 'text-amber-300' }
      ];

      let html = \`
        <div class="flex items-center justify-between mb-4">
          <h4 class="text-amber-400 font-bold text-sm">
            <i class="fa-solid fa-scale-balanced mr-2"></i>Side-by-Side Comparison (\${rows.length} selected items)
          </h4>
          <button onclick="clearBreakdownSelection()" class="text-slate-400 hover:text-rose-400 text-xs font-bold px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition">
            ✖ Clear Selection
          </button>
        </div>
        <div class="overflow-x-auto">
        <table class="w-full text-xs text-left" dir="ltr">
          <thead>
            <tr>
              <th class="p-2 text-slate-400 font-bold text-left">Metric</th>
              \${rows.slice(0, 4).map(r => \`<th class="p-2 text-white font-bold text-left text-[11px] max-w-[140px]"><div class="truncate" title="\${r.name}">\${r.name.slice(0,30)}\${r.name.length>30?'…':''}</div></th>\`).join('')}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
      \`;
      metrics.forEach(m => {
        html += \`<tr class="hover:bg-slate-800/40">\`;
        html += \`<td class="p-2 text-slate-400 font-bold whitespace-nowrap text-left">\${m.label}</td>\`;
        rows.slice(0, 4).forEach(r => {
          let val = r[m.key] !== undefined ? r[m.key] : 0;
          if (m.key === '_qr')   val = r.crmLeads > 0 ? (r.qual / r.crmLeads) * 100 : 0;
          if (m.key === '_cpl')  val = r.crmLeads > 0 ? r.spend / r.crmLeads : 0;
          if (m.key === '_cpql') val = r.qual > 0 ? r.spend / r.qual : 0;
          html += \`<td class="p-2 text-left \${m.color} font-bold">\${m.fmt(val)}</td>\`;
        });
        html += \`</tr>\`;
      });
      html += \`</tbody></table></div>\`;
      document.getElementById('breakdownComparePanelContent').innerHTML = html;
    }

    function renderBreakdownTable() {
      const thead = document.getElementById('breakdownTableHeader');
      const tbody = document.getElementById('breakdownTableBody');
      tbody.innerHTML = '';

      // Air-tight dataset filtering by selectedCampaignId, selectedAdsetId, selectedAdId
      let dataset = ALL_META_SPEND.filter(s => {
        if (s.day < campStartDate || s.day > campEndDate) return false;
        if (selectedCampaignId !== 'ALL' && s.campaignId !== selectedCampaignId) return false;
        if (selectedAdsetId !== 'ALL' && s.adsetId !== selectedAdsetId) return false;
        if (selectedAdId !== 'ALL' && s.adId !== selectedAdId) return false;
        return true;
      });

      const leadsInRange = ALL_LEADS.filter(l => {
        if (!l.date || l.date < campStartDate || l.date > campEndDate) return false;
        if (selectedCampaignId !== 'ALL') {
          const matchCamp = l.campaignId === selectedCampaignId ||
                            (l.campaignId && selectedCampaignId && l.campaignId.length >= 13 && selectedCampaignId.length >= 13 && l.campaignId.slice(0, 13) === selectedCampaignId.slice(0, 13));
          if (!matchCamp) return false;
        }
        if (selectedAdsetId !== 'ALL') {
          const matchAdset = l.adsetId === selectedAdsetId ||
                             (l.adsetId && selectedAdsetId && l.adsetId.length >= 13 && selectedAdsetId.length >= 13 && l.adsetId.slice(0, 13) === selectedAdsetId.slice(0, 13));
          if (!matchAdset) return false;
        }
        if (selectedAdId !== 'ALL') {
          const matchAd = l.adId === selectedAdId ||
                          (l.adId && selectedAdId && l.adId.length >= 13 && selectedAdId.length >= 13 && l.adId.slice(0, 13) === selectedAdId.slice(0, 13));
          if (!matchAd) return false;
        }
        return true;
      });

      const selectedCount = Object.keys(selectedBreakdownRows).length;

      if (campBreakdownTab === 'CAMPAIGNS') {
        thead.innerHTML =
          \`<th class="p-3 w-8 text-left text-slate-400">#</th>\` +
          makeThSort('name',     'Campaign Name') +
          makeThSort('spend',    'Spend (EGP)') +
          makeThSort('crmLeads', 'CRM Leads') +
          makeThSort('cpl',      'CPL') +
          makeThSort('qual',     'Qualified') +
          makeThSort('qualRate', 'Qual Rate %') +
          makeThSort('cpql',     'CPQL') +
          makeThSort('meetings', 'Scanning') +
          makeThSort('deals',    'Deals') +
          \`<th class="p-3 text-left text-slate-400">Action</th>\`;

        const grouped = {};
        dataset.forEach(s => {
          const key = s.campaignId;
          if (!grouped[key]) grouped[key] = { id: key, name: s.campaignName, spend: 0, metaLeads: 0, crmLeads: 0, qual: 0, meetings: 0, deals: 0 };
          grouped[key].spend += s.spend || 0;
          grouped[key].metaLeads += s.results || 0;
        });
        leadsInRange.forEach(l => {
          // Robust multi-layer match: exact ID -> 13-digit prefix -> normalized name
          let target = grouped[l.campaignId];
          if (!target) {
            const lPrefix = l.campaignId ? l.campaignId.slice(0, 13) : '';
            const lNorm = normalizeName(l.campaignName);
            for (const key of Object.keys(grouped)) {
              const g = grouped[key];
              if (lPrefix && key.length >= 13 && key.slice(0, 13) === lPrefix) { target = g; break; }
              const gNorm = normalizeName(g.name);
              if (lNorm && gNorm && (lNorm === gNorm || lNorm.includes(gNorm) || gNorm.includes(lNorm))) { target = g; break; }
            }
          }
          if (target) {
            target.crmLeads++;
            if (l.status === 'Qualified') target.qual++;
            if (l.meetingDate && l.meetingDate.trim()) target.meetings++;
            if (l.dealDate && l.dealDate.trim()) target.deals++;
          }
        });

        let rows = Object.values(grouped).map(r => ({
          ...r,
          cpl:      r.crmLeads > 0 ? r.spend / r.crmLeads : 0,
          cpql:     r.qual > 0 ? r.spend / r.qual : 0,
          qualRate: r.crmLeads > 0 ? (r.qual / r.crmLeads) * 100 : 0
        }));
        rows = sortBreakdown(rows);

        rows.forEach(r => {
          const isSelected = !!selectedBreakdownRows[r.id];
          const tr = document.createElement('tr');
          tr.className = \`transition border-b border-slate-800 cursor-pointer \${isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'hover:bg-slate-800/60'}\`;
          const qrColor = getQualRateColor(r.qualRate);
          tr.innerHTML = \`
            <td class="p-3 text-left" onclick="event.stopPropagation()"><input type="checkbox" class="accent-amber-400 cursor-pointer" \${isSelected ? 'checked' : ''} onchange="toggleBreakdownRow('\${r.id}', \${JSON.stringify(r).replace(/"/g,'&quot;')})" /></td>
            <td class="p-3 font-bold text-white font-sans text-xs max-w-xs truncate hover:text-[#fce8a5] text-left" title="\${r.name}" onclick="drilldownToCampaign('\${r.id}')">
              <i class="fa-solid fa-bullhorn text-blue-400 mr-1.5"></i> \${r.name}
            </td>
            <td class="p-3 text-blue-300 font-bold text-left">\${r.spend.toLocaleString('en-US',{minimumFractionDigits:2})} EGP</td>
            <td class="p-3 text-emerald-300 font-black text-sm text-left">\${r.crmLeads}</td>
            <td class="p-3 text-cyan-300 font-bold text-left">\${r.cpl.toFixed(2)} EGP</td>
            <td class="p-3 text-emerald-400 font-bold text-left">\${r.qual}</td>
            <td class="p-3 \${qrColor} text-left">\${r.qualRate.toFixed(1)}%</td>
            <td class="p-3 text-amber-300 font-bold text-left">\${r.cpql > 0 ? r.cpql.toFixed(2) + ' EGP' : '-'}</td>
            <td class="p-3 text-purple-300 font-bold text-left">\${r.meetings}</td>
            <td class="p-3 text-emerald-300 font-bold text-left">\${r.deals}</td>
            <td class="p-3 text-left" onclick="event.stopPropagation()">
              <button onclick="drilldownToCampaign('\${r.id}')" class="px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600 hover:text-white transition font-bold text-[10px] flex items-center gap-1">
                <span>Ad Sets</span> <i class="fa-solid fa-arrow-right text-[9px]"></i>
              </button>
            </td>
          \`;
          tbody.appendChild(tr);
        });
        const selInfo = selectedCount >= 2 ? \` · <span class="text-amber-400">\${selectedCount} items selected</span>\` : '';
        document.getElementById('breakdownRecordCount').innerHTML = \`Displaying \${rows.length} Active Campaigns\${selInfo}\`;

      } else if (campBreakdownTab === 'ADSETS') {
        thead.innerHTML =
          \`<th class="p-3 w-8 text-left text-slate-400">#</th>\` +
          makeThSort('name',     'Ad Set Name') +
          makeThSort('camp',     'Parent Campaign') +
          makeThSort('spend',    'Spend (EGP)') +
          makeThSort('crmLeads', 'CRM Leads') +
          makeThSort('cpl',      'CPL') +
          makeThSort('qual',     'Qualified') +
          makeThSort('qualRate', 'Qual Rate %') +
          makeThSort('cpql',     'CPQL') +
          \`<th class="p-3 text-left text-slate-400">Action</th>\`;

        const grouped = {};
        dataset.forEach(s => {
          const key = s.adsetId;
          if (!grouped[key]) grouped[key] = { id: key, name: s.adsetName, camp: s.campaignName, spend: 0, metaLeads: 0, crmLeads: 0, qual: 0 };
          grouped[key].spend += s.spend || 0;
          grouped[key].metaLeads += s.results || 0;
        });
        leadsInRange.forEach(l => {
          let target = grouped[l.adsetId];
          if (!target) {
            const lPrefix = l.adsetId ? l.adsetId.slice(0, 13) : '';
            const lNorm = normalizeName(l.adsetName);
            for (const key of Object.keys(grouped)) {
              const g = grouped[key];
              if (lPrefix && key.length >= 13 && key.slice(0, 13) === lPrefix) { target = g; break; }
              const gNorm = normalizeName(g.name);
              if (lNorm && gNorm && (lNorm === gNorm || lNorm.includes(gNorm) || gNorm.includes(lNorm))) { target = g; break; }
            }
          }
          if (target) {
            target.crmLeads++;
            if (l.status === 'Qualified') target.qual++;
          }
        });

        let rows = Object.values(grouped).map(r => ({
          ...r,
          cpl:      r.crmLeads > 0 ? r.spend / r.crmLeads : 0,
          cpql:     r.qual > 0 ? r.spend / r.qual : 0,
          qualRate: r.crmLeads > 0 ? (r.qual / r.crmLeads) * 100 : 0
        }));
        rows = sortBreakdown(rows);

        rows.forEach(r => {
          const isSelected = !!selectedBreakdownRows[r.id];
          const tr = document.createElement('tr');
          tr.className = \`transition border-b border-slate-800 cursor-pointer \${isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'hover:bg-slate-800/60'}\`;
          const qrColor = getQualRateColor(r.qualRate);
          tr.innerHTML = \`
            <td class="p-3 text-left" onclick="event.stopPropagation()"><input type="checkbox" class="accent-amber-400 cursor-pointer" \${isSelected ? 'checked' : ''} onchange="toggleBreakdownRow('\${r.id}', \${JSON.stringify(r).replace(/"/g,'&quot;')})" /></td>
            <td class="p-3 font-bold text-white font-sans text-xs max-w-sm truncate hover:text-[#fce8a5] text-left" title="\${r.name}" onclick="drilldownToAdset('\${r.id}')">
              <i class="fa-solid fa-layer-group text-purple-400 mr-1.5"></i> \${r.name}
            </td>
            <td class="p-3 text-slate-400 text-[11px] truncate max-w-xs text-left">\${r.camp}</td>
            <td class="p-3 text-blue-300 font-bold text-left">\${r.spend.toLocaleString('en-US',{minimumFractionDigits:2})} EGP</td>
            <td class="p-3 text-emerald-300 font-black text-sm text-left">\${r.crmLeads}</td>
            <td class="p-3 text-cyan-300 font-bold text-left">\${r.cpl.toFixed(2)} EGP</td>
            <td class="p-3 text-emerald-400 font-bold text-left">\${r.qual}</td>
            <td class="p-3 \${qrColor} text-left">\${r.qualRate.toFixed(1)}%</td>
            <td class="p-3 text-amber-300 font-bold text-left">\${r.cpql > 0 ? r.cpql.toFixed(2) + ' EGP' : '-'}</td>
            <td class="p-3 text-left" onclick="event.stopPropagation()">
              <button onclick="drilldownToAdset('\${r.id}')" class="px-2.5 py-1 rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600 hover:text-white transition font-bold text-[10px] flex items-center gap-1">
                <span>Ads</span> <i class="fa-solid fa-arrow-right text-[9px]"></i>
              </button>
            </td>
          \`;
          tbody.appendChild(tr);
        });
        const selInfo = selectedCount >= 2 ? \` · <span class="text-amber-400">\${selectedCount} items selected</span>\` : '';
        document.getElementById('breakdownRecordCount').innerHTML = \`Displaying \${rows.length} Ad Sets\${selInfo}\`;

      } else if (campBreakdownTab === 'ADS') {
        thead.innerHTML =
          \`<th class="p-3 w-8 text-left text-slate-400">#</th>\` +
          makeThSort('name',     'Ad / Creative Name') +
          makeThSort('adsetName','Parent Ad Set') +
          makeThSort('spend',    'Spend (EGP)') +
          makeThSort('crmLeads', 'CRM Leads') +
          makeThSort('cpl',      'CPL') +
          makeThSort('qual',     'Qualified') +
          makeThSort('qualRate', 'Qual Rate %') +
          makeThSort('cpql',     'CPQL');

        const grouped = {};
        dataset.forEach(s => {
          const key = s.adId;
          if (!grouped[key]) {
            grouped[key] = { id: key, name: s.adName, adsetName: s.adsetName, campName: s.campaignName, spend: 0, metaLeads: 0, crmLeads: 0, qual: 0 };
          }
          grouped[key].spend += s.spend || 0;
          grouped[key].metaLeads += s.results || 0;
        });
        leadsInRange.forEach(l => {
          let target = grouped[l.adId];
          if (!target) {
            const lPrefix = l.adId ? l.adId.slice(0, 13) : '';
            const lNorm = normalizeName(l.adName);
            for (const key of Object.keys(grouped)) {
              const g = grouped[key];
              if (lPrefix && key.length >= 13 && key.slice(0, 13) === lPrefix) { target = g; break; }
              const gNorm = normalizeName(g.name);
              if (lNorm && gNorm && (lNorm === gNorm || lNorm.includes(gNorm) || gNorm.includes(lNorm))) { target = g; break; }
            }
          }
          if (target) {
            target.crmLeads++;
            if (l.status === 'Qualified') target.qual++;
          }
        });

        let rows = Object.values(grouped).map(r => ({
          ...r,
          cpl:      r.crmLeads > 0 ? r.spend / r.crmLeads : 0,
          cpql:     r.qual > 0 ? r.spend / r.qual : 0,
          qualRate: r.crmLeads > 0 ? (r.qual / r.crmLeads) * 100 : 0
        }));
        rows = sortBreakdown(rows);

        rows.forEach(r => {
          const isSelected = !!selectedBreakdownRows[r.id];
          const tr = document.createElement('tr');
          tr.className = \`transition border-b border-slate-800 cursor-pointer \${isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'hover:bg-slate-800/60'}\`;
          const qrColor = getQualRateColor(r.qualRate);
          let badge = '<span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-[10px]">EG</span>';
          if (r.campName.includes('SA') || r.adsetName.includes('SA') || r.name.toLowerCase().includes('sa ')) {
            badge = '<span class="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px]">SA (مغتربين)</span>';
          }
          tr.innerHTML = \`
            <td class="p-3 text-left" onclick="event.stopPropagation()"><input type="checkbox" class="accent-amber-400 cursor-pointer" \${isSelected ? 'checked' : ''} onchange="toggleBreakdownRow('\${r.id}', \${JSON.stringify(r).replace(/"/g,'&quot;')})" /></td>
            <td class="p-3 font-bold text-white font-sans text-xs max-w-sm truncate text-left" title="\${r.name}">
              <i class="fa-solid fa-rectangle-ad text-amber-400 mr-1.5"></i> \${r.name} \${badge}
            </td>
            <td class="p-3 text-slate-400 text-[11px] truncate max-w-xs text-left" title="\${r.adsetName}">\${r.adsetName}</td>
            <td class="p-3 text-blue-300 font-bold text-left">\${r.spend.toLocaleString('en-US',{minimumFractionDigits:2})} EGP</td>
            <td class="p-3 text-emerald-300 font-black text-sm text-left">\${r.crmLeads}</td>
            <td class="p-3 text-cyan-300 font-bold text-left">\${r.cpl.toFixed(2)} EGP</td>
            <td class="p-3 text-emerald-400 font-bold text-left">\${r.qual}</td>
            <td class="p-3 \${qrColor} text-left">\${r.qualRate.toFixed(1)}%</td>
            <td class="p-3 text-amber-300 font-bold text-left">\${r.cpql > 0 ? r.cpql.toFixed(2) + ' EGP' : '-'}</td>
          \`;
          tbody.appendChild(tr);
        });
        const selInfo = selectedCount >= 2 ? \` · <span class="text-amber-400">\${selectedCount} items selected</span>\` : '';
        document.getElementById('breakdownRecordCount').innerHTML = \`Displaying \${rows.length} Isolated Creatives & Ads\${selInfo}\`;
      }
    }

    function handleExport() {
      if (currentView === 'CAMPAIGNS') {
        let csv = 'Day,Campaign Name,Ad Set Name,Ad Name,Ad ID,Amount Spent (EGP),Results\\n';
        filteredSpend.forEach(s => {
          csv += \`"\${s.day}","\${s.campaignName}","\${s.adsetName}","\${s.adName}","\${s.adId}","\${s.spend}","\${s.results}"\\n\`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = \`Amlaak_Meta_Campaigns_\${new Date().toISOString().slice(0,10)}.csv\`;
        link.click();
      } else {
        let csv = 'Date,Name,Phone,Country,Area,Condition,Location,Ad,Status,Scanning Date,Deal Date,Owner,Notes\\n';
        filteredLeads.forEach(l => {
          csv += \`"\${l.date}","\${l.name}","\${l.phone}","\${l.country}","\${l.areaNum}","\${l.condition}","\${l.location}","\${l.adName}","\${l.status}","\${l.meetingDate}","\${l.dealDate}","\${l.owner}","\${l.notes}"\\n\`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = \`Amlaak_CRM_Leads_\${new Date().toISOString().slice(0,10)}.csv\`;
        link.click();
      }
    }

    window.onload = function() {
      if (sessionStorage.getItem('amlaak_auth') === 'true') {
        document.getElementById('securityGate').classList.add('hidden');
        switchView('HUB');
        fetchLiveGoogleData();
      }
    };

    window.onresize = function() {
      if (sessionStorage.getItem('amlaak_auth') === 'true') {
        if (currentView === 'LEADS') renderLeadsCharts();
        else if (currentView === 'CAMPAIGNS') renderMetaTrendChart();
      }
    };
  </script>
</body>
</html>
  `;

  const outPath = fs.existsSync('D:\\AntigravityProjects\\amlaak-leads-dashboard')
    ? 'D:\\AntigravityProjects\\amlaak-leads-dashboard\\index.html'
    : 'F:\\AntigravityProjects\\amlaak-leads-dashboard\\index.html';
  fs.writeFileSync(outPath, portalHtml, 'utf8');
  console.log(`Successfully deployed pristine UTF-8 Arabic portal to ${outPath}!`);
}

generatePerfectPortal();
