/*!
 * LenDenClub portfolio scraper — single-file console edition (v3)
 * ------------------------------------------------------------------
 * Run on https://app.lendenclub.com while logged in, with DevTools open:
 *   1. Open the Console tab.
 *   2. Paste this whole file and press Enter.
 *   3. Wait for "DONE". Two JSON files download automatically.
 *
 * What it does
 *   - Pages the v5 investor-loan-list endpoint for OPEN and CLOSED loans.
 *   - Fetches borrower-details for every loan (score, bureau, city, income...).
 *   - Fetches portfolio totals and the live marketplace snapshot.
 *   - Produces the two files the analytics pipeline expects:
 *       lending_data_import_<date>.json   flat loan records
 *       lendenclub_FULL_<date>.json       list rows + raw detail payloads
 *
 * Safety
 *   - Signed agreement URLs are removed (STRIP_AGREEMENT = true).
 *   - PAN / phone / email keys are removed recursively.
 *   - No data leaves your browser. Nothing is uploaded.
 *   - Raw files stay local; do not commit them (see .gitignore).
 *
 * Config
 *   investorId / apiKey are auto-detected from the page. If detection fails,
 *   set them manually below: open DevTools > Network > any investor-api call,
 *   copy the investor_id query parameter and the x-ldc-key request header.
 */
(async () => {
  'use strict';

  const CONFIG = {
    apiBase: 'https://investor-api.lendenclub.com/api/ims/retail-investor/v5/web',
    investorId: '',
    apiKey: '',
    partnerCode: 'LDC',
    pageSize: 100,
    detailConcurrency: 4,
    requestDelayMs: 180,
    retries: 3,
    stripAgreement: true,
    autoDownload: true,
  };

  if (window.__ldcScraperRunning) {
    console.warn('[LDC] A scrape is already running in this tab.');
    return;
  }
  window.__ldcScraperRunning = true;

  const started = Date.now();
  const log = (...args) => console.log('%c[LDC]', 'color:#2ee6a7;font-weight:700', ...args);
  const warn = (...args) => console.warn('[LDC]', ...args);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v, fallback = 0) => {
    if (v === null || v === undefined || v === '' || v === '-') return fallback;
    const n = Number(String(v).replace(/[%,₹\s]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };
  const round = (v, dp = 2) => Math.round((Number(v) + Number.EPSILON) * 10 ** dp) / 10 ** dp;
  const txt = (v, fallback = '') => (v === null || v === undefined || v === '-' ? fallback : String(v).trim());

  // ------------------------------------------------------------------ UI ----
  const ui = document.createElement('div');
  ui.id = 'ldc-scraper-ui';
  ui.style.cssText = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
    'width:330px', 'padding:14px 16px', 'border-radius:14px',
    'background:rgba(8,13,24,.97)', 'color:#e2e8f0',
    'border:1px solid rgba(46,230,167,.35)',
    'box-shadow:0 18px 50px rgba(0,0,0,.55)',
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
  ].join(';');
  ui.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="color:#2ee6a7;letter-spacing:.04em">LDC SCRAPER</strong>
      <span data-close style="cursor:pointer;opacity:.6">✕</span>
    </div>
    <div data-phase style="margin-bottom:6px">Starting…</div>
    <div style="height:6px;border-radius:6px;background:rgba(148,163,184,.18);overflow:hidden">
      <div data-bar style="height:100%;width:0%;background:linear-gradient(90deg,#2ee6a7,#22d3ee);transition:width .2s"></div>
    </div>
    <div data-meta style="margin-top:8px;color:#94a3b8;font-size:11px"></div>
  `;
  document.body.appendChild(ui);
  const phaseEl = ui.querySelector('[data-phase]');
  const barEl = ui.querySelector('[data-bar]');
  const metaEl = ui.querySelector('[data-meta]');
  ui.querySelector('[data-close]').onclick = () => ui.remove();
  const setPhase = (text, pct, meta) => {
    if (phaseEl) phaseEl.textContent = text;
    if (barEl && Number.isFinite(pct)) barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (metaEl && meta !== undefined) metaEl.textContent = meta;
  };

  const finish = (ok, message) => {
    window.__ldcScraperRunning = false;
    setPhase(ok ? 'DONE' : 'FAILED', 100, message ?? '');
    if (!ok) warn(message);
  };

  // ------------------------------------------------------- credentials ----
  function detectCredentials() {
    const candidates = [];
    const push = (v) => {
      if (typeof v === 'string' && v && !candidates.includes(v)) candidates.push(v);
    };
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          push(storage.getItem(key));
          try {
            const value = JSON.parse(storage.getItem(key));
            if (value && typeof value === 'object') {
              for (const [k, v] of Object.entries(value)) {
                if (typeof v === 'string') push(v);
                if (v && typeof v === 'object') {
                  for (const [k2, v2] of Object.entries(v)) {
                    if (/invest|user|token|key/i.test(`${k}.${k2}`) && typeof v2 === 'string') push(v2);
                  }
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
    const investorId = CONFIG.investorId || candidates.find((v) => /^[A-Z0-9]{10}$/.test(v)) || '';
    const apiKey = CONFIG.apiKey || candidates.find((v) => v.length >= 40 && /[+/=]/.test(v)) || '';
    if (!investorId) warn('Could not auto-detect investor_id. Set CONFIG.investorId manually.');
    if (!apiKey) warn('Could not auto-detect x-ldc-key. Set CONFIG.apiKey manually.');
    return { investorId, apiKey };
  }

  const creds = detectCredentials();
  if (!creds.investorId) {
    finish(false, 'Missing investor_id — edit CONFIG.investorId at the top of the script.');
    return;
  }
  log('Investor', creds.investorId, '| key', creds.apiKey ? `${creds.apiKey.slice(0, 8)}…` : 'missing');

  // ------------------------------------------------------------- fetch ----
  const headers = (json = false) => ({
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(creds.apiKey ? { 'x-ldc-key': creds.apiKey } : {}),
  });

  async function request(path, { method = 'GET', body, retries = CONFIG.retries } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(`${CONFIG.apiBase}${path}`, {
          method,
          credentials: 'include',
          headers: headers(Boolean(body)),
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json && json.success === 0) throw new Error(json.message || 'API returned success:0');
        return json;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          const backoff = 500 * 2 ** attempt;
          warn(`${path} failed (${err.message}); retry in ${backoff}ms`);
          await sleep(backoff);
        }
      }
    }
    throw lastError;
  }

  async function pool(items, limit, worker) {
    let index = 0;
    let done = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current], current);
        done += 1;
        if (done % 25 === 0 || done === items.length) {
          setPhase('Fetching borrower details', 20 + (done / items.length) * 70, `${done} / ${items.length} loans`);
        }
      }
    });
    await Promise.all(runners);
  }

  // ------------------------------------------------------------- lists ----
  async function fetchList(type) {
    const rows = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const qs = new URLSearchParams({
        limit: String(CONFIG.pageSize),
        offset: String(offset),
        investor_id: creds.investorId,
        partner_code: CONFIG.partnerCode,
        partner_id: '',
        investment_type: 'MANUAL_LENDING',
        type,
      });
      const json = await request(`/investor-loan-list?${qs}`);
      const data = json?.data ?? {};
      const bucket = data[type.toLowerCase()] ?? data[type] ?? {};
      total = num(bucket[`${type.toLowerCase()}_count`], num(data.total_count, rows.length));
      const page = Array.isArray(bucket.loans) ? bucket.loans : Array.isArray(data.loans) ? data.loans : [];
      if (!page.length) break;
      for (const row of page) rows.push({ ...row, __list_type: type, __investment_type: 'MANUAL_LENDING' });
      offset += page.length;
      setPhase(`Listing ${type} loans`, type === 'OPEN' ? (offset / Math.max(total, 1)) * 15 : 15 + (offset / Math.max(total, 1)) * 5, `${rows.length} rows`);
      await sleep(CONFIG.requestDelayMs);
      if (page.length < CONFIG.pageSize) break;
    }
    return { rows, total };
  }

  // ----------------------------------------------------------- sanitise ----
  const PII_KEY = /^(pan|pan_no|pan_number|phone|mobile|email|aadhaar|account_number|ifsc|upi)$/i;
  function sanitise(value) {
    if (Array.isArray(value)) return value.map(sanitise);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (PII_KEY.test(key)) continue;
      if (CONFIG.stripAgreement && key === 'agreement') continue;
      out[key] = sanitise(val);
    }
    return out;
  }

  // -------------------------------------------------------------- dates ----
  function isoDate(value) {
    const s = txt(value);
    if (!s) return '';
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : '';
  }
  function addMonths(iso, months) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + months, d));
    return date.toISOString().slice(0, 10);
  }

  // ------------------------------------------------------------ flatten ----
  function toLoanRecord(row, detail) {
    const d = detail?.loan ?? {};
    const personal = detail?.personal ?? {};
    const professional = detail?.professional ?? {};
    const bureau = detail?.bureau ?? {};
    const listType = String(row.__list_type || 'OPEN').toLowerCase();
    const id = txt(row.loan_id || d.loan_id);
    const tenure = Math.max(1, Math.round(num(d.tenure, num(String(row.loan_tenure).replace(/\D+/g, ''), 1))));
    const amount = round(num(row.lent_amount, num(d.amount)), 2);
    const pos = round(num(row.pos), 2);
    const npaAmount = round(num(row.npa), 2);
    const dpd = Math.max(0, Math.round(num(d.dpd)));
    const received = round(
      listType === 'open' ? num(row.total_received_amount) : num(row.received_amount, num(row.total_received_amount)),
      2,
    );
    const principalRec = round(num(row.principal_received, num(row.principle_received)), 2);
    const fee = round(num(row.fee), 2);
    const interestRec = round(
      listType === 'open' ? num(row.net_interest_received) + fee : num(row.interest_received, received - principalRec),
      2,
    );
    const netProfit = round(
      listType === 'open' ? interestRec - fee : num(row['p_&_l'], received - amount),
      2,
    );
    const status = listType === 'open' ? 'ACTIVE' : npaAmount > 0 ? 'NPA' : 'CLOSED';
    const disb = isoDate(d.disbursement_date);
    const investment = isoDate(d.investment_date) || disb;
    const maturity = addMonths(disb, tenure);
    const closure = isoDate(d.closed_or_npa_date) || isoDate(d.closure_or_npa_date);
    const rate = round(num(String(d.borrower_apr_percent ?? '').replace('%', ''), num(row.rate)), 2);
    const incomeRaw = num(professional.income);
    const income = incomeRaw > 0 ? round(incomeRaw, 2) : 0;
    const borrowerAmount = round(num(d.amount), 2);
    const bureauRaw = num(bureau.score_range);
    const score = Math.round(num(d.lenden_score));
    const ann = amount ? round((netProfit / amount) * (12 / tenure) * 100, 2) : 0;
    const riskCategory = txt(d.risk);
    const gradeMatch = riskCategory.match(/^(AAA|AA|A)\b/i);
    const prepaid = status === 'CLOSED' && Boolean(closure && maturity && closure < maturity);

    return {
      id,
      order: txt(d.order),
      disb_date: disb,
      investment_date: investment,
      maturity_date: maturity,
      closure_date: closure,
      source: txt(row.source),
      investment_type: txt(row.__investment_type, 'MANUAL_LENDING'),
      amount,
      pos,
      status,
      tenure,
      tenure_months: tenure,
      score,
      score_bin_20: '',
      score_bin_15: '',
      rate,
      repay_type: /daily|edi/i.test(txt(row.loan_type)) ? 'Daily' : 'Monthly',
      dpd,
      dpd_bucket: dpd <= 0 ? '0 DPD' : dpd <= 30 ? '1-30 DPD' : dpd <= 60 ? '31-60 DPD' : dpd <= 90 ? '61-90 DPD' : '90+ DPD',
      overdue: dpd > 0,
      npa_flag: npaAmount > 0,
      received,
      principal_rec: principalRec,
      interest_rec: interestRec,
      fee,
      npa: npaAmount,
      net_profit: netProfit,
      ann_net_pct: ann,
      ann_npa_pct: status === 'NPA' ? ann : 0,
      borrower_name: txt(personal.name, txt(row.borrower_name, 'Borrower')).replace(/\s+/g, ' '),
      borrower_age: txt(personal.age),
      borrower_gender: txt(personal.gender),
      borrower_city: txt(personal.city),
      borrower_state: '',
      borrower_stay_type: txt(personal.stay_type),
      borrower_income: income,
      borrower_profession: txt(professional.profession, txt(d.borrower_type)),
      borrower_employer: txt(professional.employer),
      borrower_employment_status: txt(professional.employment_status),
      borrower_employment_type: txt(professional.employment_type),
      borrower_marital_status: txt(personal.marital_status),
      // Never carry signed document URLs into the flat export.
      agreement_url: '',
      bureau_score_exact: txt(bureau.score_range),
      bureau_score: bureauRaw > 0 ? Math.round(bureauRaw) : 0,
      lenden_score: txt(d.lenden_score),
      borrower_loan_amount: borrowerAmount,
      loan_to_income: borrowerAmount && income ? round(borrowerAmount / income, 2) : 0,
      loan_purpose: txt(d.loan_purpose),
      risk_category: riskCategory,
      risk_grade: gradeMatch ? gradeMatch[1].toUpperCase() : '',
      default_repayment_mode: txt(d.default_repayment_mode),
      prepaid,
      dpd_strict_npa: dpd > 90 ? 1 : 0,
      __list_type: String(row.__list_type || 'OPEN'),
      __expected_returns: round(num(row.expected_returns), 2),
      __loan_type: txt(row.loan_type, 'MONTHLY'),
      __scheme_id: txt(row.scheme_id),
    };
  }

  // ----------------------------------------------------------------- run ----
  try {
    setPhase('Fetching open loan list', 1);
    const open = await fetchList('OPEN');
    log(`Open list: ${open.rows.length} rows (reported ${open.total})`);

    setPhase('Fetching closed loan list', 17);
    const closed = await fetchList('CLOSED');
    log(`Closed list: ${closed.rows.length} rows (reported ${closed.total})`);

    const allRows = [...open.rows, ...closed.rows];
    const seen = new Set();
    const uniqueRows = allRows.filter((row) => {
      const id = txt(row.loan_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    log(`Unique loans: ${uniqueRows.length}`);
    if (!uniqueRows.length) throw new Error('No loans returned. Check investor_id and that you are logged in.');

    const details = {};
    let failed = 0;
    setPhase('Fetching borrower details', 20, `0 / ${uniqueRows.length} loans`);
    await pool(uniqueRows, CONFIG.detailConcurrency, async (row) => {
      const loanId = txt(row.loan_id);
      const qs = new URLSearchParams({
        partner_code: CONFIG.partnerCode,
        loan_id: loanId,
        source: txt(row.source, 'LMS'),
        investor_id: creds.investorId,
        is_upcoming_investments_details: 'False',
      });
      try {
        const json = await request(`/borrower-details?${qs}`);
        details[loanId] = sanitise(json?.data ?? {});
      } catch (err) {
        failed += 1;
        warn(`details failed for ${loanId}: ${err.message}`);
      }
      await sleep(CONFIG.requestDelayMs);
    });
    log(`Details: ${Object.keys(details).length} ok, ${failed} failed`);

    setPhase('Fetching portfolio totals', 92);
    let portfolio = {};
    try {
      portfolio = await request('/portfolio?investment_type=MANUAL_LENDING');
    } catch (err) {
      warn('portfolio failed:', err.message);
    }

    setPhase('Fetching marketplace snapshot', 95);
    let available = {};
    try {
      available = await request('/available-loans', {
        method: 'POST',
        body: {
          filters: [],
          sort_by: [],
          partner_code: CONFIG.partnerCode,
          investor_id: creds.investorId,
          partner_id: '',
          limit: 100,
          offset: 0,
          loan_ids: [],
        },
      });
    } catch (err) {
      warn('available-loans failed:', err.message);
    }

    const generatedAt = new Date().toISOString();
    const asOf = generatedAt.slice(0, 10);
    const loans = uniqueRows.map((row) => toLoanRecord(row, details[txt(row.loan_id)]));

    const flat = {
      generated_at: generatedAt,
      source: 'lendenclub_scraper_v3',
      // Deliberately redacted: the dashboard never needs the investor identifier.
      investor_id: 'redacted',
      portfolio_kpis_source: portfolio?.data ?? portfolio ?? {},
      available_loans_sample: available?.data ?? available ?? {},
      loans,
    };

    const full = {
      generated_at: generatedAt,
      investor_id: 'redacted',
      counts: {
        open: open.rows.length,
        closed: closed.rows.length,
        details: Object.keys(details).length,
        failed_details: failed,
        reported_open: open.total,
        reported_closed: closed.total,
      },
      loan_lists: {
        open: open.rows,
        closed: closed.rows,
      },
      borrower_details: details,
      normalize_failures: failed,
      portfolio: portfolio?.data ?? portfolio ?? {},
      available_loans: available?.data ?? available ?? {},
    };

    const download = (name, data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    if (CONFIG.autoDownload) {
      download(`lending_data_import_${asOf}.json`, flat);
      await sleep(600);
      download(`lendenclub_FULL_${asOf}.json`, full);
    }

    // Keep copies in window for manual save if the automatic download was blocked.
    window.__ldcScrapeResult = { flat, full };

    const counts = loans.reduce(
      (acc, loan) => {
        acc[loan.status] = (acc[loan.status] || 0) + 1;
        return acc;
      },
      {},
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log('Status mix', counts);
    log(`Files ready in ${seconds}s. window.__ldcScrapeResult has both payloads.`);
    finish(
      true,
      `${loans.length} loans · ${counts.ACTIVE || 0} active · ${counts.CLOSED || 0} closed · ${counts.NPA || 0} NPA · ${seconds}s`,
    );
  } catch (err) {
    console.error(err);
    finish(false, err?.message || String(err));
  }
})();
