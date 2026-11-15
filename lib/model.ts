// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor that the model rates highest: the early rows the radar
// exists to find. A protocol records no token when its index entry carries no market cap, no CoinGecko
// id and no symbol; the snapshot's live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, learned from the snapshot itself:
//
//   prior(category) = global x factor(category)
//       global = median(mcap_usd / tvl_usd) over token-trading protocols with mcap_usd > 0
//       factor = 1 + (n / (n + 5)) x (median_C / global - 1), clamped to [0.4, 2.5]
//                only for categories with n >= 5 mcap observations; otherwise factor = 1
//       priors are clamped to [0.03, 1.50] as a final guard
//   wrapFactor      = 0.5 if the category is a receipt product, or the name carries a whole word
//                     wrapped / staked / staking; else 1.0
//   growth          = clamp(change_7d, -40, +40) per cent; null 7d reads as 0
//   growthMult      = 1 + (growth / 100) x 0.6
//   maturity        = 0.6 + min(age, 1095) / 1095 x 0.4          (age <= 1095 days)
//                   = 1.0 - 0.15 x min((age - 1095) / 730, 1)   (age > 1095 days; floor 0.85)
//                   unknown age reads as 365 days
//   implied         = max(1, round(tvl_usd x prior x wrapFactor x growthMult x maturity))
//
// Why each term is there: a token is worth a fraction of the value it secures, and that fraction differs
// by business — basis-trading and DEX tokens trade rich against TVL because the token captures trading
// flow, lending and liquid-staking tokens trade thin because TVL is mostly other people's deposits. The
// starter's flat 0.25 ignores that spread; the prior is learned from the same snapshot's 128
// token-trading protocols with a real market cap, never from a hand-kept list of names. The n >= 5 gate,
// the shrinkage toward the global median and the factor clamp keep single-protocol artifacts (a 400x
// prediction-market token, a 0.006x allocator token) from moving the board. The wrap factor extends the
// watchlist's own rule to the early rows: a receipt for an asset that already trades is not a first
// token. The growth clamp tames single-week spikes (one protocol jumped 4,448% in a week). Maturity
// rises to three years, then decays gently: a protocol that ran four-plus years with no token on record
// is slightly less likely to launch than one at two to three years.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: the rules, stated once, that the dashboard prints and the sandbox may move. */
export interface ModelConstants {
  /** How many mcap observations a category needs before its own median moves its prior. */
  min_obs: number;
  /** Shrinkage strength: factor = 1 + (n / (n + shrink_k)) x (median_C / global - 1). */
  shrink_k: number;
  /** The category factor's clamp. */
  factor_min: number;
  factor_max: number;
  /** The prior's final clamp. */
  prior_min: number;
  prior_max: number;
  /** The structural factor for receipt products. */
  wrap_factor: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  maturity_decay: number;
  maturity_decay_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  min_obs: 5,
  shrink_k: 5,
  factor_min: 0.4,
  factor_max: 2.5,
  prior_min: 0.03,
  prior_max: 1.5,
  wrap_factor: 0.5,
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 40,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  maturity_decay: 0.15,
  maturity_decay_days: 730,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many early rows the radar carries: the highest-implied pre-token protocols below the floor. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories whose token would be a receipt for an asset that already trades. */
export const WRAP_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
  'Stablecoin Wrapper',
]);

/** A name carrying one of these whole words is a wrapped, staked or bridged product. */
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;

/** One learned prior: a category, how many protocols calibrated it, and their median multiple. */
export interface CategoryPrior {
  category: string;
  n: number;
  median: number;
  prior: number;
}

/** Everything the model learned from the snapshot before scoring a single row. */
export interface Calibration {
  /** Median mcap/TVL over token-trading protocols with a market cap above zero. */
  global_median: number;
  /** How many protocols calibrated the global median. */
  n: number;
  /** One entry per category that earned its own prior (n >= min_obs). */
  priors: CategoryPrior[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    prior: number;
    prior_n: number;
    prior_median: number;
    wrap_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  prior: number;
  prior_n: number;
  prior_median: number;
  wrap_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** Whether the row is one of the snapshot's watchlist slugs (the floor, never the ceiling). */
  watch: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; the mean of the two middles when the count is even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Learn the priors from the snapshot's own token-trading set: every protocol with a market cap above
 * zero (a dead or empty quote at zero is not a price). The global median is the fallback every category
 * starts from; a category earns its own prior only when at least `min_obs` protocols calibrate it, and
 * even then its median is shrunk toward the global one so one loud protocol cannot set the price.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const trading = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = median(trading.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of trading) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const priors: CategoryPrior[] = [];
  for (const [category, multiples] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (multiples.length < model.min_obs) continue;
    const catMedian = median(multiples);
    const factor = Math.min(
      model.factor_max,
      Math.max(model.factor_min, 1 + (multiples.length / (multiples.length + model.shrink_k)) * (catMedian / global - 1)),
    );
    const prior = Math.min(model.prior_max, Math.max(model.prior_min, global * factor));
    priors.push({ category, n: multiples.length, median: catMedian, prior });
  }
  return { global_median: global, n: trading.length, priors };
}

/** A category's learned prior, or the global median when the category earned none. */
export function priorFor(category: string | null, calibration: Calibration): { prior: number; n: number; median: number } {
  const found = calibration.priors.find((p) => p.category === (category ?? 'Other'));
  if (!found) return { prior: calibration.global_median, n: 0, median: calibration.global_median };
  return { prior: found.prior, n: found.n, median: found.median };
}

/** Whether a protocol is a receipt product: its category, or a wrapped/staked word in its name. */
export function isWrap(p: SnapshotProtocol): boolean {
  return (p.category !== null && WRAP_CATEGORIES.has(p.category)) || WRAP_WORD.test(p.name);
}

/** The growth multiplier for one protocol's seven-day change, clamped the way the model says. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/** The maturity multiplier for one protocol's age: up to three years, then a gentle decay. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  if (a <= model.maturity_days) {
    return model.maturity_floor + (Math.min(Math.max(a, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  return 1 - model.maturity_decay * Math.min((a - model.maturity_days) / model.maturity_decay_days, 1);
}

/** The multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  prior: number;
  prior_n: number;
  prior_median: number;
  wrap: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { prior, n, median: priorMedian } = priorFor(protocol.category, calibration);
  const wrap = isWrap(protocol) ? model.wrap_factor : 1;
  const { pct: growthPct, mult: growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * prior * wrap * growthMult * maturityMult));
  return { implied, prior, prior_n: n, prior_median: priorMedian, wrap, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, scored by implied value, capped.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen. Scoring by value, not by
  // TVL, is the point — a receipt product with a big TVL must not outrank a real protocol.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, calibration, model) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      prior: round4(s.v.prior),
      prior_n: s.v.prior_n,
      prior_median: round4(s.v.prior_median),
      wrap_factor: s.v.wrap,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, for the bridge step back; the first when there is only one. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/**
 * How much capital one farm position needs, from the protocol's own TVL. The ladder is finer than a
 * flat tier because most of the board sits below $25M: a $50 position is real money on a small protocol
 * and a $300 one is proportionate on a billion-dollar one.
 */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** Gas for a setup transaction on a chain: Ethereum is the expensive one, the rest are cheap. */
function setupGas(chain: string): string {
  return chain === 'Ethereum' ? '$5–15 of gas' : 'under $3 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield aggregator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s main stable pair on ${chain} and keep the position open.`;
  }
  if (c.includes('yield') || c.includes('basis') || c.includes('leveraged farm')) {
    return `Deposit $${capital} into the yield position on ${name} on ${chain} and keep it open.`;
  }
  if (c.includes('rwa')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC from ${chain} to ${secondChainOf(p)} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt.`;
  }
  if (c === 'chain') {
    return `Bridge $${capital} of USDC onto ${name} and use its native app once on ${chain}.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use the protocol's core function.`;
}

/** The second action, a week later: the same category's work, done a second, distinct time. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield aggregator')) {
    return `Deposit a second, smaller amount into a different vault of ${name} on ${chain}.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Repay the borrow on ${name}, then supply again so the log shows two distinct actions.`;
  }
  if (c.includes('dex')) {
    return `Swap a small amount through the same ${name} pool on ${chain} once a week.`;
  }
  if (c.includes('yield') || c.includes('basis') || c.includes('leveraged farm')) {
    return `Harvest or compound once if the ${name} position on ${chain} shows accrued yield.`;
  }
  if (c.includes('rwa')) {
    return `Hold the ${name} asset on ${chain} through one distribution cycle.`;
  }
  if (c.includes('bridge')) {
    return `Bridge a small amount back from ${secondChainOf(p)} to ${chain} through ${name} the following week.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Close the first position on ${name}, then open a second small one the next week.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Restake, or add to the ${name} position on ${chain} once.`;
  }
  if (c === 'chain') {
    return `Transact on ${name} weekly, a swap or a transfer, so the wallet stays active.`;
  }
  if (c.includes('insurance')) {
    return `Renew or top up the cover from ${name} on ${chain} once.`;
  }
  return `Repeat the core function of ${name} on ${chain} a second week.`;
}

/** The risk the farm actually carries, by category: the honest line, not a slogan. */
function riskNoteFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || (c.includes('yield') && !c.includes('yield aggregator'))) {
    return `Risk: impermanent loss if the pair moves — the position can lose value even if a token launches.`;
  }
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield aggregator')) {
    return `Risk: smart-contract risk on the vault — the deposit is the cost of the farm, not a guarantee of anything.`;
  }
  if (c.includes('bridge')) {
    return `Risk: bridge risk — funds are in transit and the bridge contract holds them until they land.`;
  }
  if (c.includes('stable') || c.includes('rwa')) {
    return `Risk: depeg risk — the asset can trade below its peg while you hold it.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Risk: liquidation risk — a margined position can be closed at a loss.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Risk: liquidation risk — a borrow can be closed if the collateral falls.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Risk: the receipt token already trades, so a new governance token is the least certain outcome on this board.`;
  }
  return `Risk: smart-contract risk — the position can lose value, and farming may return nothing.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. What it never says: no airdrop date, no token name, no point program — the snapshot carries
 * none of those, so the claim step is conditional, and the plan ends on the honest line that an
 * implied value is a model, not a price.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = setupGas(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${chain === 'Ethereum' ? '$5–15' : '$2–4'} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about ${chain === 'Ethereum' ? '$5–10' : '$1–3'} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `IF ${p.name} publishes a rewards or points page, claim only from the link it publishes, and never pay to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log. ${riskNoteFor(p)} Implied value is a model, not a price: farming costs gas and time and may return nothing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watch: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    prior: row.model.prior,
    prior_n: row.model.prior_n,
    prior_median: row.model.prior_median,
    wrap_factor: row.model.wrap_factor,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watch,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
