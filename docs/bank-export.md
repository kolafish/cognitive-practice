# Online bank export

The online bank contains 5598 records.

```json
{
  "total": 5598,
  "byCategory": {
    "figure": 300,
    "memory": 63,
    "spatial": 2080,
    "verbal": 3155
  },
  "byType": {
    "choice": 4415,
    "construction": 220,
    "memory-grid": 32,
    "memory-digits": 11,
    "memory-binding": 20,
    "folding-video": 900
  },
  "byLevel": {
    "figure": {
      "1": 43,
      "2": 43,
      "3": 42,
      "4": 39,
      "5": 36,
      "6": 34,
      "7": 34,
      "8": 29
    },
    "memory": {
      "1": 3,
      "2": 3,
      "3": 16,
      "4": 5,
      "5": 7,
      "6": 19,
      "8": 10
    },
    "spatial": {
      "1": 80,
      "2": 105,
      "3": 399,
      "4": 348,
      "5": 336,
      "6": 358,
      "7": 363,
      "8": 91
    },
    "verbal": {
      "1": 51,
      "2": 249,
      "3": 563,
      "4": 381,
      "5": 1117,
      "6": 158,
      "7": 226,
      "8": 410
    }
  },
  "excludedCount": 51,
  "mediaCount": 3594,
  "mediaBytes": 338594051,
  "sourceRows": 5649,
  "practiceLevelsAreEstimates": true,
  "englishOriginalRequired": 460
}
```

Practice levels are source-specific heuristics normalized to 1–8 solely for step-up/step-down practice. Original difficulty and the per-question basis are retained. They are not an IRT-calibrated composite score.

ACCES's 51 images are excluded pending explicit redistribution permission. No age filtering is applied. MaRs uses the md option variant once per base item. BIG-bench keeps stem groups so the selector can avoid reusing the same scenario.

Folding videos ask only for the total hole count, a derived question from the original structured-answer task; full original answers and answer images are retained.

Tatool sequences containing positions up to 16 use an adapted 4×4 grid with row-major 1-based positions. The 850 ms display / 250 ms interval is a practice setting, not a reconstruction of source norms.

Some spatial items need the original English text to preserve specific motion, view, or composition conditions. Show originalPromptEn visibly when promptNeedsOriginal=true. Embedded A–D labels must retain their source IDs and order.

Rebuild with `python3 scripts/build-bank.py --source /path/to/beijing-academy-carnival-research`. All copied media are content-addressed and validated locally; exported data contain no local filesystem paths.
