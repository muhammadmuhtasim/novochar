# Catalogue decision review — spherical-shell explorer (Mode B, Observe)

> Status: **decision recorded, no source enabled.** This document is the review
> required before Milestone 2 can use a real distance-bearing catalogue and
> before Milestone 5 (index / LOD) is designed. It is referenced by the plan,
> §18. It does not change any behaviour on its own.
>
> Date: 2026-10-16. Sources verified against the primary pages listed in §7 on
> that date; terms and documentation can change, so re-check before ingesting.

## 1. Why this review exists

The shell explorer is complete and honest end to end on a small, explicitly
redistributable fixture, but that fixture is a placeholder (plan §17.3). The
next step named in the plan is **one real catalogue, end to end, before any
broad expansion** — and the gate on that step is licensing, frame, units and
distance semantics, not code. This document records that review and the decision.

Two facts constrain the decision from the outset:

- Novochar's own commercial intent is still **undecided** (see
  `data/catalog/PROVENANCE.md`, "Status: production catalogue on hold").
- The project may therefore not assume it qualifies for a
  non-commercial-only licence, and must not vendor data whose terms are
  unresolved.

The decision below is therefore a **choice of primary candidate plus the exact
conditions under which it may be enabled**, not an enablement.

## 2. Candidate A — Gaia DR3 (primary)

### 2.1 Provenance and citation

- **Mission / DPAC:** European Space Agency (ESA) mission Gaia; processed by the
  Gaia Data Processing and Analysis Consortium (DPAC).
- **Release:** Gaia Data Release 3 (Gaia DR3), 13 June 2022.
- **Required acknowledgement** (verbatim, from the ESA credit and citation
  instructions):

  > This work has made use of data from the European Space Agency (ESA) mission
  > *Gaia* (https://www.cosmos.esa.int/gaia), processed by the *Gaia* Data
  > Processing and Analysis Consortium (DPAC,
  > https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has
  > been provided by national institutions, in particular the institutions
  > participating in the *Gaia* Multilateral Agreement.

- **Citation:** Gaia Collaboration et al. (2016), "The Gaia mission", A&A 595,
  A1; and Gaia Collaboration et al. (2022), "Gaia Data Release 3", A&A 674, A1
  (as directed by the DR3 credit page). DOI `10.17876/gaia/dr.3`.

### 2.2 Licence and redistribution — the gate

- ESA Space Science Archives data, including Gaia, are distributed under the
  **Creative Commons Attribution-NonCommercial 3.0 IGO licence (CC BY-NC 3.0
  IGO)**.
- The ESA Terms and Conditions for the use of data state that raw/calibrated and
  higher-level data are under CC BY-NC 3.0 IGO, and that **commercial use
  requires prior written authorisation** from ESA (contact published by ESA as
  `data.licences@esa.int`).
- The **NonCommercial** clause is the decisive constraint: if Novochar is or
  becomes a commercial product, redistributing Gaia data inside it (bundled,
  served, or precomputed into the app) is **not** covered by the open licence
  and needs ESA authorisation first. Attribution alone is not sufficient.
- Attribution is required regardless: the acknowledgement in §2.1 must be shown
  in the product's credits/about (and this repository's provenance notes).

**Consequence.** Gaia DR3 cannot be enabled until one of these is true:

1. Novochar is confirmed to be a **non-commercial** use (the NC clause then
   permits redistribution with attribution), or
2. **written authorisation for commercial use** is obtained from ESA.

This mirrors the "production catalogue on hold" status already recorded for the
bright-star candidates in `data/catalog/PROVENANCE.md`.

### 2.3 Frame, epoch, reference system

Verified from the Gaia DR3 datamodel and release documentation:

| Property | Value |
| --- | --- |
| Reference frame | **ICRS** (via Gaia-CRF3, aligned to the ICRS) |
| Reference epoch (`ref_epoch`) | **J2016.0** (Julian years, TCB) |
| `ra`, `dec` | degrees, barycentric, ICRS at `ref_epoch` |
| `parallax`, `parallax_error` | **milliarcseconds (mas)**, at `ref_epoch` |
| Time system | TCB |
| Proper motions | mas/yr (`pmra`, `pmdec`) |

- The shell's canonical frame is ICRS, so **no frame transform is needed** — this
  is the main reason Gaia is the cleaner primary candidate than a FK5 catalogue.
- The epoch is **J2016.0**, not J2000. The row's own `ref_epoch` must be carried
  through as provenance; it must not be silently relabelled J2000. Distances are
  epoch-independent, so this does not affect the radial classification, but it
  does govern any future sky-plane propagation of proper motion.
- `ref_epoch` is a **column in the data**; ingestion records it rather than
  assuming a constant.

### 2.4 Distance semantics — parallax is the evidence, not a distance

This is the part that most directly touches the project's "never fabricate
distances" rule.

- **`gaia_source` has no distance column.** The published quantity is the
  parallax `parallax` (mas) with its standard error `parallax_error` (mas).
  Distance is derived, not read.
- A published parallax becomes a **point distance** (`1000 / parallax` mas → pc,
  then → ly); a parallax **with its error** becomes the **asymmetric interval**
  `[1000/(p+σ), 1000/(p−σ)]` (unbounded above when `p ≤ σ`). This is exactly the
  mapping the M2 adapter already implements (`parallaxIntervalLightYears`,
  `server/shell/sources.js`), and it is the only route that populates the
  `uncertain` layer.
- **Negative or zero parallaxes are possible and are not distances.** They must
  be classified as `unknown` (direction only), never inverted into a position.
  This matches the existing classifier.
- **Known systematics that we must surface, not silently correct:**
  - a **parallax zero point** of about **−17 µas** measured from extragalactic
    sources in the ESA (E)DR3 documentation ("a tentative correction formula for
    the parallax zero point is provided"); the raw `parallax` column is not
    zero-point corrected;
  - **`ruwe`** (renormalised unit weight error): values above roughly **1.4**
    flag a poor single-star astrometric fit (`parallax_over_error`, and the
    astrometric goodness-of-fit, are related quality indicators).
  These belong in `qualityNotes` and in a provenance field — applied as
  *documented caveats*, never as a hidden fudge to the distance.
- **Model-based distances exist but are a different claim.** The Bailer-Jones
  geometric/photogeometric catalogue (VizieR `I/352`,
  `external.gaiaedr3_distance`) provides *prior-dependent* distance estimates,
  not measurements. If ever used, they must be labelled as model-based
  (posterior), never presented as the object's measured distance, and they carry
  their own paper/citation.

**Recommendation for the first real source:** classify from the **raw parallax
and its error** (the existing interval path). Do **not** introduce a model
distance in the first integration; that keeps the radial result a direct reading
of the published measurement.

### 2.5 Identity and provenance mapping

- **Identity:** `source_id` — a unique 64-bit integer per source within a
  release. It is the stable key for dedup and for known-record tests. Map it to
  the project's stable id, e.g. `gaia-dr3-<source_id>`.
- **Provenance** carried on each record must include at least: source
  (`gaia`), catalogue (`Gaia DR3`), release, `ref_epoch`, the ESA
  acknowledgement reference, and any applied quality flags (`ruwe`,
  `parallax_over_error`). This satisfies the plan's rule that provenance and
  frames are preserved, and that an "uncertain" record is never confused with a
  located one.
- **Display fields** (`phot_g_mean_mag`, etc.) are carried through unchanged, as
  the M2 adapter already does.

### 2.6 Access and ingestion shape

- **Primary service:** the ESA Gaia Archive TAP interface
  (`https://gea.esac.esa.int/tap-server/tap`), queried with ADQL, returning
  CSV/VOTable/FITS/JSON. Anonymous access is sufficient for public DR3 tables.
- **Mirror:** CDS VizieR catalogue **`I/355`** (`gaiadr3`, main source), also
  reachable over TAPVizieR. Useful as a second, independent read for
  cross-checking a small extract.
- **Ingestion must be bounded and reproducible**, not a bulk download of the
  ~1.8 billion rows: a fixed ADQL query over `gaiadr3.gaia_source` selecting an
  explicit column set and an explicit cut (for example a parallax-signal and
  magnitude range chosen for the shell's bright/near use case), pinned to the
  release. The exact cut is an owner decision (§6) and a property of the
  committed downloaded artifact, not of any runtime request.
- **Determinism** must match the existing pipeline contract in
  `data/catalog/PROVENANCE.md` (Build integrity): no timestamps, byte-identical
  reruns, explicit nulls.

### 2.7 Reasons Gaia is the primary

- **Frame-native:** ICRS, so no FK5→ICRS transform and no frame caveat.
- **Honest uncertainty:** a measured `parallax_error` exists, so the `uncertain`
  layer can be populated from real evidence instead of an invented error.
- **Stable identity:** the 64-bit `source_id` makes dedup and known-record tests
  exact.
- **Quality metadata:** `ruwe` / `parallax_over_error` let us flag bad fits
  without touching the measured value.

### 2.8 What we will not do with a real catalogue

- We will not substitute a rounded or "representative" distance for a record
  that lacks one.
- We will not turn an interval into a scalar for display; the interval stays
  primary, as already implemented.
- We will not apply the parallax zero-point correction silently, nor label an
  uncorrected parallax as if it were fully calibrated.
- We will not mash Gaia and BSC5 records into one anonymous set: each keeps its
  own source, frame/epoch and provenance.

## 3. Candidate B — BSC5 (VizieR V/50) (secondary cross-check)

The Yale Bright Star Catalogue, 5th Revised Ed. (preliminary), Hoffleit &
Warren Jr. (1991), `V/50`. Already implemented behind an adapter and a
documented evaluation download in `data/catalog/PROVENANCE.md`.

What it is actually good for, and what blocks it:

- **Coverage/role:** ~9,100 stars brighter than about V 6.5, with cross-ids. A
  useful **bright-sky cross-check** for a small nearby subset, not a
  distance-rich survey.
- **Frame/epoch:** positions are **FK5, equinox J2000, epoch J2000** — **not
  ICRS**. The existing server-side frame policy reports and refuses a non-ICRS
  catalogue rather than treating it as ICRS, so enabling BSC5 as a positional
  source first requires a documented **FK5→ICRS transform** (and carrying the
  original frame/equinox in provenance). Gaia needs no such transform.
- **Distance semantics:** the catalogue publishes a parallax in **arcseconds**,
  **optional**, with **no published uncertainty**, and a flag distinguishing a
  **trigonometric** parallax from a **dynamical** one. Consequences:
  - with no error, only a **point** distance is available — BSC5 alone cannot
    populate the `uncertain` layer, and must not be given a fabricated error;
  - a **dynamical** parallax is a model-derived quantity, not a direct
    measurement, and must be flagged or excluded, not averaged in with the
    trigonometric ones.
- **Licence:** **still unresolved.** The V/50 page states no explicit licence;
  the ReadMe carries the historical wording that the catalogue "has been made
  available only for dissemination on the Astronomical Data Center CD ROM", and
  the CDS general terms make commercial usage "subject to rules depending on
  origin". Neither is a clear open licence for redistribution in a product whose
  commercial intent is undecided.

**Decision for BSC5:** keep it as a **secondary crossing/validation source
only**, and only after (a) its redistribution terms are confirmed in writing
for our use, and (b) the FK5→ICRS transform exists and is tested. It does not
become the primary radial source, because it cannot supply honest distance
uncertainties.

## 4. Decision

- **Primary radial source: Gaia DR3**, using the raw `parallax` /
  `parallax_error` published in `gaia_source` (ICRS, epoch J2016.0, mas),
  because it is frame-native (no transform), it has honest published distance
  uncertainty, it carries a stable 64-bit identity, and it is openly published.
- **Secondary source: BSC5 (V/50)**, as a bright-sky cross-check only, gated on
  confirmed terms and an FK5→ICRS transform; it cannot supply honest uncertainty
  on its own.
- **Gate (blocking):** confirm Novochar's use is non-commercial **or** obtain
  ESA authorisation for commercial use. Gaia DR3 is **not enabled** until the
  gate is satisfied.
- **Enablement** additionally requires the acceptance criteria in §5 to pass and
  a bounded, reproducible ingestion artifact committed under
  `data/catalog/`.
- **Until then**, the active source remains the CC0 fixture. Nothing about Mode
  A or the current Mode B behaviour changes.
- **M5 stays deferred** until a real source is integrated and measured, so the
  index is built against real access patterns rather than a guess.

## 5. Acceptance criteria for the first real source

These are the tests and properties the first real source must satisfy before it
is enabled. They are written to be checkable by the existing harnesses and the
test suite, and they follow the plan's provenance and no-fabrication rules.

**Ingestion / provenance**

- **Reproducible artifact:** the ingestion script is deterministic — same query
  and release in, byte-identical file out, no timestamps and no machine-specific
  fields.
- **Pinned selection:** the query, release and column set are recorded alongside
  the artifact, so the result can be regenerated exactly.
- **Attribution:** the Gaia acknowledgement (§2.1) is carried in the artifact's
  provenance and surfaced in the product's credits.
- **Bounded size:** the extraction is a deliberate, documented subset
  (magnitude / distance cut), not a bulk copy of the archive.

**Classified records**

- **Point vs interval:** a parallax with an error produces an interval record,
  never a scalar.
- **Open intervals:** `p ≤ σ` produces an open (upper-unbounded) interval and is
  classified `uncertain`, not located and not unknown.
- **Non-positive parallax:** zero or negative parallax yields `unknown`,
  direction-only, with **no 3D position invented**.
- **Outside band:** a precise distance outside the band yields `outside`
  (excluded), never `uncertain`.
- **Frame/epoch preserved:** each record carries ICRS and its `ref_epoch`; the
  client and server both honour the frame policy.

**Tests**

- **Known-record tests:** a small, curated set of bright nearby stars with
  published Gaia DR3 parallaxes, asserted against the classifier's output using
  the source's own `source_id` — including at least one point case, one interval
  case, and one deliberately negative-parallax case. Values are taken from the
  ingested artifact (committed), not typed from memory.
- **Brute-force cross-check:** the candidate-pruning path is checked against a
  brute-force classification of the same artifact, so no true member is dropped.
- **End-to-end:** the record flows ingestion → adapter → `queryShell` → client
  row with provenance intact, exercised by a fixture-derived test.
- **The browser acceptance** adds one real-source check when a non-fixture
  artifact is enabled.

## 6. Conditions to unblock (summary)

1. **Licence:** confirm non-commercial use, or obtain ESA authorisation. This is
   the only hard blocker for Gaia.
2. **Ingestion scope:** choose the bounded subset and commit the reproducible
   artifact per §5.
3. **If cross-checking with BSC5:** confirm its terms and add a tested FK5→ICRS
   transform first.
4. **Then:** design M5 against the real source's measured costs (the current
   linear-scan benchmark is in plan §17.4).

## 7. Sources (verified 2026-10-16)

- Gaia licence page (ESA Cosmos): CC BY-NC 3.0 IGO —
  https://www.cosmos.esa.int/web/gaia-users/license
- ESA Space Science Archives terms and conditions (data use; commercial use
  requires prior authorisation) —
  https://www.cosmos.esa.int/web/esdc/terms-and-conditions
- Gaia credit and citation instructions (acknowledgement text) —
  https://gea.esac.esa.int/archive/documentation/GDR1/Miscellaneous/sec_credit_and_citation_instructions.html
- Gaia DR3 contents / release summary —
  https://www.cosmos.esa.int/web/gaia/dr3
- Gaia (E)DR3 content: reference epoch J2016.0, ICRS, parallax zero point
  ≈ −17 µas from extragalactic sources —
  https://www.cosmos.esa.int/web/gaia/earlydr3
- Gaia DR3 datamodel, `gaia_source` columns (source_id, ref_epoch, ra, dec,
  parallax, parallax_error, parallax_over_error, ruwe, phot_g_mean_mag) —
  https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html
- Gaia archive programmatic (TAP) access —
  https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access
- VizieR Gaia DR3 Part 1 main source (`I/355`) —
  http://cdsarc.u-strasbg.fr/viz-bin/Cat?I/355
- VizieR Bailer-Jones EDR3 distances (`I/352`) —
  https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/I/352
- VizieR Bright Star Catalogue 5th ed. (`V/50`) and ReadMe —
  https://cdsarc.cds.unistra.fr/viz-bin/Cat?V/50 and
  https://cdsarc.u-strasbg.fr/ftp/V/50/ReadMe
- In-repo provenance (fixture, BSC5 candidate, licence gate) —
  `data/catalog/PROVENANCE.md`
