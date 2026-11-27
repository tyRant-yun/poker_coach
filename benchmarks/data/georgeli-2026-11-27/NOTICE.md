# George Li public poker datasets

Author and credit: **George Li, georgelipoker.com**.

Source and download catalogue: <https://georgelipoker.com/data>, retrieved 2026-11-27.
License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The two JSON files retain their original bytes and embedded attribution/license metadata. No endorsement by the author is implied.

| File | SHA-256 |
| --- | --- |
| push-fold-heads-up.json | abdcbc31e4c201ad5210cc94152aee11fe6d7af30e7d05fda2040ec979cf8f1b |
| preflop-equity.json | 997e6d278315f71073d8516c1cc4d942df1a3b4ab1f7a8154f2cdeda02640ef4 |

These are research and validation assets, **not installed product scoring data**. The strategy is HU shove/fold only, no ante, 1–20BB in 0.5BB steps. It cannot evaluate Riverline's current 100BB raise/limp/call game. Its EV origin is before posting blinds; it must not be read directly as current-node sunk-cost EV.

Our separate audit reconstructs physical-card compatibility, recomputes action EV and best-response gaps from the supplied rounded equity matrix, and independently samples three equity matchups. This checks limited-model consistency; it does not independently certify the entire equity matrix or establish general preflop accuracy. See [current data boundaries](../../../docs/data-sources.md) and the [historical acquisition report](../../../docs/archive/2026-11-27/riverline-preflop-data-acquisition-2026-11-27.md).
