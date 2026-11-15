// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own inputs and the protocol's farm plan. No network: every byte it shows is in
// data.js. The model lives here in the open, not behind the board: impliedOf recomputes a row
// from the snapshot figures and the page checks the number board.json carries, so the page's
// code and the board's data are visibly the same arithmetic.
//
// The priors below are what radar-2 learned from THIS snapshot's 128 token-trading protocols
// (global median mcap/TVL 0.214): Basis Trading 0.471 (n=7), Bridge 0.401 (n=6), Canonical
// Bridge 0.535 (n=8), Dexs 0.302 (n=11), Lending 0.153 (n=15), Liquid Staking 0.102 (n=9),
// RWA 0.253 (n=9), Yield 0.199 (n=9); every other category reads the global 0.214. The code
// recomputes them from the calibration in data.js with the same shrinkage — the numbers above
// are the result, printed so a reader can check the arithmetic without running anything.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  // The model's rules, as constants the page prints and the sandbox may move.
  var MODEL = {
    min_obs: 5, shrink_k: 5, factor_min: 0.4, factor_max: 2.5,
    prior_min: 0.03, prior_max: 1.5, wrap_factor: 0.5,
    growth_weight: 0.6, growth_floor: -40, growth_cap: 40,
    maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
    maturity_decay: 0.15, maturity_decay_days: 730, unknown_age_days: 365
  };
  var WRAP_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX', 'Stablecoin Wrapper'];
  var WRAP_WORD = /\b(wrapped|staked|staking)\b/i;

  var state = {
    q: '', category: 'all', chain: 'all', tvl: 'all', growthOnly: false,
    scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    sandbox: { base: null, growthW: null, matScale: null }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(3); }

  // The model in one function: prior (learned, shrunk), wrap factor, growth, maturity.
  function priorOf(category) {
    var cal = DATA.calibration;
    var found = null;
    for (var i = 0; i < cal.priors.length; i++) if (cal.priors[i].category === (category || 'Other')) found = cal.priors[i];
    if (!found) return { prior: cal.global_median, n: 0, median: cal.global_median };
    return { prior: found.prior, n: found.n, median: found.median };
  }
  function isWrap(row) {
    return (row.category && WRAP_CATS.indexOf(row.category) >= 0) || WRAP_WORD.test(row.name);
  }
  function maturityOf(age) {
    var a = (age === null || age === undefined) ? MODEL.unknown_age_days : age;
    if (a <= MODEL.maturity_days) return MODEL.maturity_floor + (Math.min(Math.max(a, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    return 1 - MODEL.maturity_decay * Math.min((a - MODEL.maturity_days) / MODEL.maturity_decay_days, 1);
  }
  // o overrides the shipped constants (the sandbox): {base, growthW, matScale}. With no overrides
  // this is exactly the function main.ts ran, so the check in the detail view must agree.
  function impliedOf(row, o) {
    var base = o && o.base !== null && o.base !== undefined ? o.base : priorOf(row.category).prior;
    var wrap = isWrap(row) ? MODEL.wrap_factor : 1;
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gw = o && o.growthW !== null && o.growthW !== undefined ? o.growthW : MODEL.growth_weight;
    var growthMult = 1 + (growth / 100) * gw;
    var mat = maturityOf(row.age_days);
    if (o && o.matScale !== null && o.matScale !== undefined) mat = 1 - (1 - mat) * o.matScale;
    return Math.max(1, Math.round(row.tvl_usd * base * wrap * growthMult * mat));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : chainOf(p); }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 300;
    if (p.tvl_usd >= 5e8) return 200;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 2.5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main stable pair on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + ' into the yield position on ' + name + ' on ' + chain + ' and keep it open.';
    if (c.indexOf('rwa') >= 0) return 'Mint or buy $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC from ' + chain + ' to ' + secondChainOf(p) + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and hold the receipt.';
    if (c === 'chain') return 'Bridge $' + capital + ' of USDC onto ' + name + ' and use its native app once on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + " and use the protocol's core function.";
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Deposit a second, smaller amount into a different vault of ' + name + ' on ' + chain + '.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay the borrow on ' + name + ', then supply again so the log shows two distinct actions.';
    if (c.indexOf('dex') >= 0) return 'Swap a small amount through the same ' + name + ' pool on ' + chain + ' once a week.';
    if (c.indexOf('yield') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Harvest or compound once if the ' + name + ' position on ' + chain + ' shows accrued yield.';
    if (c.indexOf('rwa') >= 0) return 'Hold the ' + name + ' asset on ' + chain + ' through one distribution cycle.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back from ' + secondChainOf(p) + ' to ' + chain + ' through ' + name + ' the following week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the first position on ' + name + ', then open a second small one the next week.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake, or add to the ' + name + ' position on ' + chain + ' once.';
    if (c === 'chain') return 'Transact on ' + name + ' weekly, a swap or a transfer, so the wallet stays active.';
    if (c.indexOf('insurance') >= 0) return 'Renew or top up the cover from ' + name + ' on ' + chain + ' once.';
    return 'Repeat the core function of ' + name + ' on ' + chain + ' a second week.';
  }
  function riskNoteFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || (c.indexOf('yield') >= 0 && c.indexOf('yield aggregator') < 0)) return 'Risk: impermanent loss if the pair moves — the position can lose value even if a token launches.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Risk: smart-contract risk on the vault — the deposit is the cost of the farm, not a guarantee of anything.';
    if (c.indexOf('bridge') >= 0) return 'Risk: bridge risk — funds are in transit and the bridge contract holds them until they land.';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0) return 'Risk: depeg risk — the asset can trade below its peg while you hold it.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Risk: liquidation risk — a margined position can be closed at a loss.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Risk: liquidation risk — a borrow can be closed if the collateral falls.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Risk: the receipt token already trades, so a new governance token is the least certain outcome on this board.';
    return 'Risk: smart-contract risk — the position can lose value, and farming may return nothing.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var eth = chain === 'Ethereum';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: eth ? '$5–15 of gas' : 'under $3 of gas', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + (eth ? '$5–15' : '$2–4') + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about ' + (eth ? '$5–10' : '$1–3') + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'IF ' + p.name + ' publishes a rewards or points page, claim only from the link it publishes, and never pay to claim.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log. ' + riskNoteFor(p) + ' Implied value is a model, not a price: farming costs gas and time and may return nothing.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = params.get('tvl');
    if (params.get('scope')) state.scope = params.get('scope');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl !== 'all') params.set('tvl', state.tvl);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Whether a row is one of the snapshot's watchlist slugs (the floor, never the ceiling).
  function isWatch(r) { return !!r.watch; }

  function sandboxActive() {
    return state.sandbox.base !== null || state.sandbox.growthW !== null || state.sandbox.matScale !== null;
  }
  function sandboxValues(row) {
    if (!sandboxActive()) return row.implied_value_usd;
    return impliedOf(row, state.sandbox);
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.tvl !== 'all') {
        var t = r.tvl_usd;
        if (state.tvl === 'b1' && t < 1e9) return false;
        if (state.tvl === 'm100' && (t < 1e8 || t >= 1e9)) return false;
        if (state.tvl === 'm25' && (t < 2.5e7 || t >= 1e8)) return false;
        if (state.tvl === 'lt25' && t >= 2.5e7) return false;
      }
      if (state.growthOnly && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.scope === 'watch' && !isWatch(r)) return false;
      if (state.scope === 'early' && isWatch(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    return list;
  }
  function sortedRows(list) {
    var key = state.sort;
    var sb = sandboxActive();
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = sb ? sandboxValues(a) : a.implied_value_usd; bv = sb ? sandboxValues(b) : b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · radar-2' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, picked by implied value — not by TVL. Implied value is a model, not a promise.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 10);
    return el('section', { class: 'spot' },
      el('h2', null, 'Top 10 by implied value ', el('span', { text: '— the strongest launches this snapshot can see' })),
      el('div', { class: 'cards' }, top.map(function (r, i) {
        return el('button', { class: 'card' + (i < 3 ? ' hot' : ''), type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · ' + fmtPct(r.change_7d) + ' 7d' })
        );
      }))
    );
  }

  function categoryStrip() {
    var counts = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var max = counts[cats[0]] || 1;
    return el('section', { class: 'strip' },
      el('h2', { text: 'Board by category — select one to filter' }),
      el('div', { class: 'bars' }, cats.map(function (c) {
        return el('button', { class: 'bar-row', type: 'button', 'data-active': state.category === c ? 'true' : 'false', onclick: function () { state.category = state.category === c ? 'all' : c; writeHash(); render(); } },
          el('span', { class: 'bar-label', text: c }),
          el('span', { class: 'bar-track' }, el('i', { style: 'width:' + Math.max(3, Math.round((counts[c] / max) * 100)) + '%' })),
          el('span', { class: 'bar-count', text: String(counts[c]) })
        );
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'tvl', 'aria-label': 'Filter by TVL' },
      el('option', { value: 'all', text: 'Any TVL' }),
      el('option', { value: 'b1', text: 'TVL $1B and up', selected: state.tvl === 'b1' ? 'selected' : null }),
      el('option', { value: 'm100', text: 'TVL $100M – $1B', selected: state.tvl === 'm100' ? 'selected' : null }),
      el('option', { value: 'm25', text: 'TVL $25M – $100M', selected: state.tvl === 'm25' ? 'selected' : null }),
      el('option', { value: 'lt25', text: 'TVL under $25M', selected: state.tvl === 'lt25' ? 'selected' : null })
    );
    tvlSel.addEventListener('change', function () { state.tvl = tvlSel.value; writeHash(); render(); });
    var growthBtn = el('button', { class: 'toggle', type: 'button', 'aria-pressed': state.growthOnly ? 'true' : 'false', text: 'Growing only (7d > 0)', onclick: function () { state.growthOnly = !state.growthOnly; render(); } });
    var scopeAll = el('button', { type: 'button', 'aria-pressed': state.scope === 'all' ? 'true' : 'false', text: 'All rows', onclick: function () { state.scope = 'all'; writeHash(); render(); } });
    var scopeWatch = el('button', { type: 'button', 'aria-pressed': state.scope === 'watch' ? 'true' : 'false', text: 'Watchlist', onclick: function () { state.scope = 'watch'; writeHash(); render(); } });
    var scopeEarly = el('button', { type: 'button', 'aria-pressed': state.scope === 'early' ? 'true' : 'false', text: 'Early', onclick: function () { state.scope = 'early'; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var shown = state.tab === 'pre-token' ? filteredRows().length : DATA.live.length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL' }), tvlSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Momentum' }), growthBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'tabs' }, scopeAll, scopeWatch, scopeEarly)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? shown + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var sb = sandboxActive();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 'all'; state.growthOnly = false; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = (sb ? sandboxValues(list[0]) : list[0].implied_value_usd) || 1;
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var value = sb ? sandboxValues(r) : r.implied_value_usd;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: isWatch(r) ? 'watch' : null,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(sb ? i + 1 : r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null, el('b', { text: r.name }), isWatch(r) ? el('span', { class: 'badge', text: 'WATCH' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(value) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token on record' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sb ? 'Sandbox re-ranking: the board re-sorted by your sliders. The shipped board in board.json is unchanged.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the market the priors are learned from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var moved = 0;
    if (sandboxActive()) {
      var shipped = {};
      DATA.rows.forEach(function (r) { shipped[r.slug] = r.rank; });
      var reranked = DATA.rows.slice().sort(function (a, b) { return sandboxValues(b) - sandboxValues(a) || (a.slug < b.slug ? -1 : 1); });
      reranked.forEach(function (r, i) { if (shipped[r.slug] !== i + 1) moved++; });
    }
    function slider(id, label, min, max, step, value, fmt, oninput) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var out = el('span', { class: 'val', text: fmt(value) });
      input.addEventListener('input', function () { out.textContent = fmt(parseFloat(input.value)); oninput(parseFloat(input.value)); });
      return el('div', { class: 'row' }, el('label', { for: id, text: label }), input, out);
    }
    var resetBtn = el('button', { class: 'button', type: 'button', text: 'Reset to radar-2', onclick: function () { state.sandbox = { base: null, growthW: null, matScale: null }; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The prior is learned from the snapshot itself: ' + cal.n + ' token-trading protocols with a market cap above zero, median mcap/TVL ' + fmtMult(cal.global_median) + '.' }),
      el('div', { class: 'formula' },
        el('div', null, el('b', { text: 'implied = round( tvl_usd × prior(category) × wrap × growth × maturity )' })),
        el('div', { text: 'prior = ' + fmtMult(cal.global_median) + ' × factor, factor = 1 + (n / (n + ' + m.shrink_k + ')) × (median_C / ' + fmtMult(cal.global_median) + ' − 1), clamped [' + m.factor_min + ', ' + m.factor_max + '], only when n ≥ ' + m.min_obs + '; priors clamped [' + m.prior_min + ', ' + m.prior_max + ']' }),
        el('div', { text: 'wrap = ' + m.wrap_factor + ' for receipt products (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX, Stablecoin Wrapper, or a wrapped / staked / staking word in the name), else 1' }),
        el('div', { text: 'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '  ·  maturity = ' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ' up to 3y, then −' + m.maturity_decay + ' at most by 5y; unknown age = ' + m.unknown_age_days + 'd' })
      ),
      el('div', { class: 'calib' }, cal.priors.map(function (p) {
        return el('div', null, el('span', { text: p.category + ' (n=' + p.n + ', median ' + fmtMult(p.median) + ')' }), el('b', { text: fmtMult(p.prior) }));
      }).concat([el('div', null, el('span', { text: 'All other categories (global median)' }), el('b', { text: fmtMult(cal.global_median) }))]))
      ,
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox — move a slider and the board re-ranks from the same function' }),
        slider('sb-base', 'Base multiple (prior)', 0.05, 0.5, 0.005, state.sandbox.base !== null ? state.sandbox.base : cal.global_median, function (v) { return fmtMult(v) + '×'; }, function (v) { state.sandbox.base = v; render(); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, state.sandbox.growthW !== null ? state.sandbox.growthW : m.growth_weight, function (v) { return v.toFixed(2); }, function (v) { state.sandbox.growthW = v; render(); }),
        slider('sb-mat', 'Maturity effect', 0, 1, 0.05, state.sandbox.matScale !== null ? state.sandbox.matScale : 1, function (v) { return Math.round(v * 100) + '%'; }, function (v) { state.sandbox.matScale = v; render(); }),
        el('p', { class: 'note' }, sandboxActive() ? el('span', null, el('b', { text: String(moved) + ' rows moved' }), ' vs the shipped radar-2 board. The sandbox only re-ranks this page — board.json is unchanged.') : 'Sliders start at the shipped radar-2 values. Moving one proves the board is a function, not a hardcoded list.'),
        resetBtn
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function whyRank(row) {
    var sameCat = DATA.rows.filter(function (r) { return (r.category || 'Other') === (row.category || 'Other'); })
      .sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    var catRank = sameCat.findIndex(function (r) { return r.slug === row.slug; }) + 1;
    var byTvl = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var tvlRank = byTvl.findIndex(function (r) { return r.slug === row.slug; }) + 1;
    var p = priorOf(row.category);
    return 'Ranked #' + row.rank + ' of ' + DATA.board_size + '. It is the #' + catRank + ' ' + (row.category || 'Other') + ' protocol on the board — that category trades at a median ' + fmtMult(p.median) + '× TVL' + (p.n > 0 ? ' across ' + p.n + ' token-trading protocols' : '') + ', giving a prior of ' + fmtMult(p.prior) + ' — and it holds the #' + tvlRank + '-largest TVL on the board.';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, null);
    var p = priorOf(row.category);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatch(row) ? ' · watchlist' : ' · early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this rank' }),
      el('p', { class: 'sub', text: whyRank(row) })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the waterfall' }),
      el('div', { class: 'waterfall' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category prior (' + (row.category || 'Other') + (p.n > 0 ? ', n=' + p.n : ', global median') + ')' }), el('b', { text: '× ' + fmtMult(row.prior) })),
        el('div', null, el('span', { text: 'Wrap factor' + (row.wrap_factor < 1 ? ' — receipt product' : '') }), el('b', { text: '× ' + row.wrap_factor })),
        el('div', null, el('span', { text: 'Seven-day growth (' + fmtPct(row.change_7d) + ')' }), el('b', { text: '× ' + fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity (' + fmtAge(row.age_days) + ' with no token on record)' }), el('b', { text: '× ' + fmtMult(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    shell.appendChild(categoryStrip());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
