# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Robkynd/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Robkynd/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for make.fun [`token-radar-01`](https://make.fun/bounty/token-radar-01): a token launch
radar — a dashboard that ranks pre-token protocols by the implied value of the token they
might one day issue, and shows how to farm each one. $1,325 in prizes; the entry runs
offline on a sealed DefiLlama snapshot (758 protocols, 40 on the watchlist).

## The model — radar-2

Implied value is learned from the snapshot itself, never from a hand-kept list of names:

```
prior(category) = global x factor(category)
    global = median(mcap_usd / tvl_usd) over token-trading protocols with mcap_usd > 0
    factor = 1 + (n / (n + 5)) x (median_C / global - 1), clamped to [0.4, 2.5]
             only for categories with n >= 5 mcap observations; otherwise factor = 1
    priors clamped to [0.03, 1.50]
wrapFactor = 0.5 for receipt products (Bridge, Canonical Bridge, Liquid Staking,
             Liquid Restaking, Restaked BTC, CEX, Stablecoin Wrapper, or a wrapped /
             staked / staking word in the name); else 1.0
growthMult = 1 + clamp(change_7d, -40, +40) / 100 x 0.6
maturity   = 0.6 + min(age, 1095) / 1095 x 0.4        (age <= 3y)
           = 1.0 - 0.15 x min((age - 1095) / 730, 1) (age > 3y; floor 0.85)
implied    = max(1, round(tvl_usd x prior x wrapFactor x growthMult x maturity))
```

On this snapshot the calibration finds a global median of 0.214 from 128 token-trading
protocols, with category priors from 0.102 (Liquid Staking) to 0.471 (Basis Trading).
The board ranks all 40 watchlist protocols plus the 160 highest-implied pre-token
protocols below the $50M floor — picked by implied value, not by TVL, so a receipt
product with a big TVL does not outrank a real protocol. Each row carries a 7-step
farm plan derived from its own category, chains, TVL and age, with concrete costs,
hold times and a category-specific risk note — and no invented airdrop date, token
name or point program.

## The dashboard

A dark, static, no-network page (`dashboard/`): a top-10 spotlight, a category
distribution strip, a sortable and filterable board (search, category, chain, TVL
range, growth, watchlist/early, pre-token/live tabs), a detail view for every
protocol with a model waterfall (TVL → prior → growth → maturity → implied) and
its farm plan, a model panel that prints the formula with the real numbers, and a
model sandbox whose sliders re-rank the board live from the same function.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22+, standard library only, no network. The program runs twice and writes
identical bytes.

## Referral

Built with make.fun — [join with my referral](https://make.fun/r/endykwq6).
