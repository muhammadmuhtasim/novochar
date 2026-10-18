# Novochar Spherical-Shell Explorer
## Concept, Scientific Models, Architecture, Recommendations, and Implementation Plan

**Document type:** Technical design proposal  
**Status:** Proposed; not implemented  
**Project:** Novochar — astronomical exploration and observation  
**Initial origin:** Sun-centered  
**Initial distance policy:** Located objects in the primary layer; uncertain-distance objects in a separate, explicitly marked layer; direction-only objects remain available in sky-direction views without fabricated 3D distances.

---

## 1. Executive Summary

Novochar should evolve from a viewer that displays a limited set of astronomical objects into a spatially queryable astronomical atlas. The central interaction is a user-controlled, hollow spherical shell centered on the Sun. Users adjust its radius and thickness to explore different heliocentric distance bands. Objects whose usable distances place them inside the band are discovered and rendered; objects whose distances are uncertain can be shown in a distinct uncertainty layer.

The inspiration is the geometry of a spherical shell, similar to the wall of a hollow tennis ball. The scientific selection rule is based on spatial distance, not magnetic flux itself. Magnetic flux measures a magnetic field passing through a surface; Novochar's shell instead defines a three-dimensional spatial selection volume.

The system should let users explore every object available from connected and accessible catalogues, while remaining honest about catalogue coverage, duplicate records, measurement uncertainty, missing distances, and incomplete queries. No architecture can guarantee that every discovered astronomical object is represented: archives differ in coverage, completeness, resolution, access, and data quality.

### Core principle

> **Query broadly, filter scientifically, render progressively, and preserve provenance.**

### Recommended starting point

Build a small, independently testable shell mathematics and data-contract layer first. Validate it against one real catalogue before building the full UI or connecting many archives. This minimizes risk and separates scientific correctness, data retrieval, and GPU rendering into reviewable pieces.

**Repository constraint:** This is a design document only. It does not authorize or imply code changes. The plan below proposes module responsibilities and possible paths; actual paths must be reconciled with the current repository before implementation.

---

## 2. The Idea and User Experience

### 2.1 The spherical-shell metaphor

Imagine a transparent, hollow sphere centered on the Sun. Its wall has a user-controlled thickness.

- The **radius** chooses the distance region being explored.
- The **thickness** controls how broad the selected distance band is.
- The **inner and outer boundaries** define the shell.
- Astronomical objects that meet the spatial rule are discovered and rendered.
- Objects with uncertain distances appear in a separate visual layer.
- Objects with no usable distance are not assigned invented 3D locations; they can still be explored in directional views.
- The 2D Observe map and 3D view remain linked through stable object identity and shared selection state.

A user can sweep the radius outward from nearby stellar space to larger Galactic regions, then adjust the thickness to narrow or broaden the selection. The same interaction can support stars, stellar remnants, clusters, nebulae, galaxies, and other source classes when the relevant catalogues supply suitable positional information.

### 2.2 What this solves

A fixed catalogue or a hard-coded list restricts discovery to a predetermined collection. A shell-based workflow changes the main interaction from “choose from the few objects currently shown” to “choose a spatial region and discover which catalogue records belong there.”

It does not automatically make all archives queryable or make all objects precisely locatable. Those capabilities depend on source data, indexes, and access methods. The architecture must accommodate those limitations rather than conceal them.

### 2.3 Initial interface concept

The Observe interface should include:

- Radius control, expressed in a human-readable distance unit.
- Thickness control, explicitly defined as **full thickness**, not half-thickness.
- Inner and outer shell boundary display.
- Sun-centered origin indicator.
- Independently toggleable located, uncertain-distance, and direction-only layers.
- Source/catalogue filters and per-source status.
- Loading progress and query-completion status.
- Counts that distinguish discovered, loaded, rendered, and estimated records.
- Object details with identifiers, distance information, uncertainty, source provenance, and data-quality notes.
- Shared 2D/3D selection and navigation.
- Rendering quality and level-of-detail status.

The shell should be visible enough to communicate the selected region, but it should not obscure the objects. A restrained translucent wireframe with distinguishable inner and outer boundaries is a sensible initial visual design.

---

## 3. Scope and Non-Goals

### 3.1 Initial scope

1. Sun-centered concentric distance bands.
2. Configurable radius and full shell thickness.
3. Exact shell membership for usable 3D distances.
4. Separate uncertainty layer.
5. A direction-only class for objects without usable distances.
6. One real catalogue integrated end-to-end before broad source expansion.
7. Spatial query, pagination, cancellation, and caching.
8. Linked 2D Observe and 3D sphere views.
9. Stable IDs, provenance, and source coverage reporting.
10. Automated scientific, integration, performance, and regression tests.

### 3.2 Non-goals for the first release

- Guaranteeing literal coverage of every astronomical object ever discovered.
- Loading every record from every archive into the browser at once.
- Treating all archives as if they expose the same query capabilities.
- Assigning invented distances to direction-only objects.
- Making probabilistic membership claims without a defensible uncertainty model.
- Replacing the existing shared astronomy core or duplicating coordinate transforms.
- Changing Mode A behavior as part of the initial shell implementation.
- Introducing a moving shell origin before Sun-centered behavior is reliable.

---

## 4. Mathematical Model

### 4.1 Definitions

Let:

- \(\mathbf{o}\) be the shell center, initially the adopted Sun position.
- \(\mathbf{x}\) be an object's 3D position in the same coordinate frame and unit system.
- \(R\) be the shell's mean radius.
- \(T\) be the shell's **full thickness**.
- \(d\) be the object's distance from the shell center.

For the initial Sun-centered implementation, use heliocentric distance for \(d\).

The general Euclidean distance is

\[
d = \lVert \mathbf{x} - \mathbf{o} \rVert
  = \sqrt{(x_x-o_x)^2+(x_y-o_y)^2+(x_z-o_z)^2}.
\]

If positions are represented by right ascension, declination, and distance, convert to a Cartesian representation in the canonical coordinate frame before applying the spatial distance test. Do not compare raw angular coordinates to a linear radius.

### 4.2 Inner and outer radii

The nominal inner radius is

\[
r_{\min} = \max\left(0, R-\frac{T}{2}\right),
\]

and the outer radius is

\[
r_{\max} = R+\frac{T}{2}.
\]

The clamp at zero prevents the inner radius from becoming negative when the thickness exceeds twice the radius. The UI and API should reject negative radius or thickness values. A zero-radius shell is a valid mathematical edge case, but the product may choose a positive minimum radius for usability.

### 4.3 Exact membership predicate

For an object with a usable adopted distance \(d\), the primary located-object predicate is

\[
\operatorname{insideShell}(d,R,T)
\iff
r_{\min}\le d\le r_{\max}.
\]

Both boundaries are inclusive. The implementation should use one shared, pure predicate rather than reimplementing slightly different versions in the UI, server, and renderer.

For numerical robustness, compare values in a normalized internal unit. Do not introduce a broad arbitrary epsilon that can change scientific membership. If tolerance is required due to representation, define and test it explicitly relative to the data model.

### 4.4 Shell as a geometric region

The shell is the set

\[
\mathcal{S}(R,T)=
\left\{\mathbf{x}\in\mathbb{R}^3:
r_{\min}\le \lVert\mathbf{x}-\mathbf{o}\rVert\le r_{\max}
\right\}.
\]

It is a **spherical volume band**, not a two-dimensional surface. Its geometry can be rendered as inner and outer spheres, but membership is determined by the entire band between them.

The corresponding volume, when \(r_{\min}\) and \(r_{\max}\) are in the same linear unit, is

\[
V_{\mathcal{S}}=\frac{4\pi}{3}
\left(r_{\max}^{3}-r_{\min}^{3}\right).
\]

For \(R\gg T\) and \(T\ll R\), the shell volume is approximately

\[
V_{\mathcal{S}}\approx 4\pi R^2T.
\]

This approximation explains why increasing radius can cause the number of selected objects to rise rapidly even if thickness stays fixed. Actual counts also depend on the spatial distribution of objects, catalogue selection functions, and completeness.

### 4.5 Units and numeric conventions

The UI can display light-years (ly), but all calculations must use one documented internal unit consistently. Parsecs are often practical for astronomical catalogues; SI units are also valid but can create unnecessarily large values. The specific choice should be made after inspecting the current data contracts.

Rules:

- Include units in every source schema and API contract.
- Convert at ingestion/query boundaries, not opportunistically inside render code.
- Reject unknown or ambiguous units.
- Avoid mixing heliocentric distance, parallax, and angular coordinates as if they were the same quantity.
- Keep display formatting separate from scientific values.
- Validate finite numbers and sensible ranges before building query parameters.

---

## 5. Distance Quality and Uncertainty

The system must distinguish “known enough to use,” “uncertain,” and “not available.” An error bar must not automatically be treated as a probability distribution. A catalogue's measurement and uncertainty conventions must be preserved.

### 5.1 Initial object classes

#### A. Located

The source provides a usable 3D position or distance under a documented quality policy. Apply the exact shell predicate to the adopted distance. Retain the original measurement, adopted value, units, quality flags, and source.

“Located” does not mean scientifically exact. It means the record meets the configured criteria for the primary rendering layer.

#### B. Uncertain distance

The source provides a distance estimate with uncertainty, an interval, a parallax-based estimate, or a posterior distribution, but the current policy cannot establish definite shell membership. These records should be shown in a separate layer and marked visually and in metadata.

#### C. Unknown distance / direction only

The source has a usable sky direction but no usable distance. It can be shown on a directional sky map, but it cannot be claimed to lie within a finite 3D shell. Do not place it at an arbitrary radius and imply that position is real.

### 5.2 Interval-based uncertainty

If a source provides a meaningful interval \([d_{\mathrm{low}},d_{\mathrm{high}}]\), the interval overlaps the shell when

\[
[d_{\mathrm{low}},d_{\mathrm{high}}]
\cap
[r_{\min},r_{\max}]
\ne \varnothing.
\]

Overlap alone does not establish membership. It indicates that the available interval is compatible with shell membership. Such records can be shown in the uncertain layer, with the interval and its confidence interpretation preserved.

If the entire interval is inside the shell, the policy may classify it as located-within-shell if the source's interval semantics and the configured quality rules support that interpretation. The classification policy should be explicit and testable.

### 5.3 Probabilistic membership

If a valid posterior distance distribution \(p(d\mid\text{data})\) is available, the probability of shell membership is

\[
P_{\mathrm{shell}}=
\int_{r_{\min}}^{r_{\max}}
p(d\mid\text{data})\,\mathrm{d}d.
\]

The UI can display this probability and the model/source from which it was derived. A threshold such as “show if \(P_{\mathrm{shell}}\ge q\)” may be introduced only after the source-specific uncertainty model is validated and the threshold is documented.

Do not assume a Gaussian distance distribution simply because a source gives a standard error. Do not transform parallax uncertainty into a symmetric distance error without a scientifically appropriate model. Negative or low-significance parallaxes, asymmetric posteriors, and selection effects require source-aware handling.

### 5.4 Recommended first-release policy

- `located`: passes the configured distance-quality policy and exact shell membership.
- `uncertain`: distance evidence overlaps or assigns non-negligible probability to the shell but does not establish definite membership under the policy.
- `unknown`: insufficient information to assess 3D shell membership.
- Keep these states separate from source quality, object type, and render visibility; they are different concepts.

The uncertainty layer must have a distinct marker style and a clear tooltip. It should not communicate false precision through a sharp, authoritative 3D position when the underlying data do not support one.

---

## 6. Coordinate Frames and Position Semantics

The shell uses a physical distance from the Sun, not a projection-plane distance. The 2D Mollweide map is a view of sky direction; it is not the spatial index used for the shell.

### Rules

1. Preserve the project's canonical astronomical record and frame policy.
2. Convert source coordinates into the canonical frame using the existing shared astronomy core.
3. Derive a 3D Cartesian direction/position only when the record has sufficient distance information.
4. Calculate shell distance in a common physical coordinate system.
5. Derive view-specific projected positions without mutating canonical records.
6. Do not duplicate astronomical transformations in UI components.
7. Preserve source frame, original coordinate fields, normalized fields, and transform/version provenance when practical.

For a sky direction \((\alpha,\delta)\) and a valid distance \(d\), one common equatorial Cartesian convention is

\[
x=d\cos\delta\cos\alpha,\qquad
y=d\cos\delta\sin\alpha,\qquad
z=d\sin\delta,
\]

where \(\alpha\) and \(\delta\) are in radians. This convention is valid only when the adopted frame, axis convention, origin, and distance semantics are documented consistently.

For a Sun-centered model, the Sun is the origin, so \(\mathbf{o}=(0,0,0)\) in the shell's heliocentric Cartesian coordinates. If source positions are barycentric or in another origin, transform them appropriately before applying the shell predicate. Do not assume every catalogue's reported distance is already a heliocentric Cartesian coordinate.

The existing 2D/3D linkage should continue to use stable object IDs. A frame switch changes derived view positions, not the identity of the selected object.

---

## 7. High-Level Architecture

The system should separate discovery, scientific filtering, and rendering. The shell should not download and scan all catalogues in the browser.

### 7.1 Pipeline

1. **Shell controls and shared Observe state:** radius, thickness, layer policy, source filters, display settings.
2. **Shell query planner:** unit normalization, conservative spatial query region, query identity, cancellation.
3. **Catalogue adapters and spatial indexes:** source-specific request/response handling and candidate retrieval.
4. **Scientific filtering:** exact shell membership, uncertainty classification, quality policy, deduplication.
5. **Normalized query result:** stable IDs, coordinates, distance quality, source provenance, pagination state.
6. **Shared scene and selection linkage:** common object identity and view-derived positions.
7. **Renderers:** 3D shell, 3D points, 2D Observe map, picking, object details, progressive loading.

### 7.2 Responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| Shell state | Radius, thickness, source/layer filters | Catalogue parsing |
| Source adapters | Source schemas, units, IDs, provenance | Visual styling |
| Spatial query service | Candidate retrieval, paging, cancellation, cache | Canvas/Three.js resources |
| Science layer | Distance semantics, uncertainty, transforms | Network transport |
| Scene/linkage | Stable IDs, selection, visibility state | Archive-specific rules |
| Renderers | Drawing, picking, level of detail | Independent copies of records |

### 7.3 Proposed module layout

These are proposed paths only and must be reconciled with the current repository before implementation.

```text
client/src/lib/observe/
  scene.js                    # Existing canonical scene/linkage
  shell/
    shell-state.js             # Radius, thickness, layer policy
    shell-geometry.js          # Inner/outer radii, membership predicate
    shell-query.js              # Query parameters and candidate filtering
    distance-model.js           # Located/uncertain/unknown classifications
    source-registry.js          # Source capabilities and coverage metadata
    source-adapters.js          # Normalized source records
    shell-cache.js              # Query/page cache and invalidation
    shell-lod.js                # Display budgets and level of detail

client/src/components/
  Observe.jsx                   # Shared shell and selection state
  ObserveShellControls.jsx      # Radius/thickness and layer controls
  ObserveSphere3D.jsx           # Shell geometry, points, picking
  ObserveMap2D.jsx              # Linked directional map
  ObserveObjectDetails.jsx      # Metadata, uncertainty, provenance

server/
  astro/
    spatial-query.js            # Candidate retrieval and exact filtering
    catalogue-registry.js       # Source metadata/capabilities
    distance-quality.js         # Validity and uncertainty classification
```

Do not create redundant modules just to match this proposed tree. Reuse existing catalog, frame-adapter, scene, and API code wherever possible.

---

## 8. Catalogue and Source Integration

The long-term goal is a unified explorer over all connected and accessible catalogues. The first implementation should integrate one real catalogue end-to-end and prove the data contract before adding more.

### 8.1 Source capability registry

Each source should describe capabilities such as:

- Supports 3D position or distance queries.
- Supports sky-coordinate queries only.
- Provides uncertainty intervals, posterior distributions, or quality flags.
- Supports pagination or continuation tokens.
- Is locally indexed, cached, queried remotely, or requires an asynchronous job.
- Has known sky coverage, distance range, epoch, or selection function.
- Has usage limits, access requirements, or known availability constraints.

Not every archive supports an arbitrary spherical-shell query. A source may need to be queried by a conservative bounding region and then filtered, or may be usable only through a local index. The registry should make these differences explicit.

### 8.2 Normalize but preserve provenance

A normalized record should preserve at least:

- Stable internal object ID.
- Source name and original source record ID.
- Object type/classification, if provided.
- Original coordinate fields and source frame.
- Normalized canonical coordinates, where valid.
- Distance value, units, semantics, and adopted value.
- Uncertainty representation and quality flags.
- Catalogue/source version or query provenance.
- Duplicate/cross-match relationships, when known.

Normalization must not erase important distinctions in the original source fields. Preserve source values and document how normalized values were derived.

### 8.3 Cross-matching and duplicates

Different catalogues can contain multiple records for the same physical object, or one source can resolve several components that another source treats as a single object. Do not deduplicate solely by display name.

Cross-matching should be a separate, auditable stage using source-appropriate position, epoch, uncertainty, and object-class information. Preserve all source identifiers and avoid irreversible merging until the matching policy is validated.

The UI may present a consolidated object with linked catalogue records, but it must remain possible to inspect provenance and understand which values came from which source.

### 8.4 Coverage and completeness

Never claim “every object ever discovered” is present merely because all configured sources responded. Report:

- Which sources were queried.
- Which sources succeeded, failed, or were skipped.
- Query completion and pagination status.
- Known source coverage and limitations.
- Whether records are exact, sampled, aggregated, or still pending.
- Whether counts are loaded, discovered, or estimated.

The honest product goal is: **explore every object exposed by the connected sources to the extent the data and access capabilities permit, with limitations visible to the user.**

---

## 9. Query and API Design

### 9.1 Query strategy

The browser should not download entire catalogues and filter them locally. The server or source index should first retrieve candidates from a conservative spatial region. The exact shell predicate then removes candidates outside the selected band.

The conservative query must be complete: it may return extra candidates, but it must not exclude objects that pass the exact shell test. For suitable data, use a 3D spatial index, distance bucket/index, or a conservative bounding query appropriate to the backend. Choose the actual index only after examining catalogue sizes, spatial distribution, source capabilities, and database technology.

### 9.2 Proposed endpoint

A possible API shape is:

```text
GET /api/observe/shell
    ?radius=1000
    &thickness=100
    &unit=ly
    &include=located,uncertain
    &sources=...
    &limit=...
    &cursor=...
```

This is a design example, not a claim that the route exists. The actual API should follow current project conventions.

The response should include:

- Normalized records and stable IDs.
- Position and distance values with explicit units.
- Distance quality and uncertainty metadata.
- Source IDs and provenance.
- Query completion status and continuation cursor.
- Source coverage information and warnings.
- Counts with clearly defined semantics.

### 9.3 Query keys and caching

Avoid caching every exact radius/thickness combination independently; continuous sliders could generate too many nearly identical keys.

Prefer caching normalized catalogue pages or spatial tiles/chunks. A query key should account for all data-affecting inputs, such as source set, spatial band, distance policy, source version, and relevant quality filters. Pure display changes such as marker color should not invalidate data caches.

### 9.4 Cancellation and concurrency

- Debounce continuous slider changes.
- Cancel obsolete network queries where supported.
- Associate each query with a unique generation/key.
- Ignore late responses that do not match the current query state.
- Preserve stable selected IDs where the selected object remains in the available data.
- Prevent stale query results from overwriting newer shell settings.
- Isolate a failed source so other sources can still return useful results.

---

## 10. Rendering and Performance

A spherical shell is not automatically cheap to render. At large radii or broad thicknesses it can contain millions of objects. Query reduction must happen before large data transfers and GPU allocation.

### 10.1 Recommended rendering approach

- Use Three.js instancing or batched point rendering rather than a separate mesh per object.
- Keep stable IDs in a lookup structure separate from GPU buffer indices.
- Render the shell boundaries separately from astronomical points.
- Use spatial tiles and level-of-detail aggregation for distant or dense regions.
- Load coarse representations first, then progressively reveal detailed records.
- Preserve access to full query results even when the viewport uses aggregation.
- Keep uncertain-distance and unknown-distance layers visually and logically distinct.
- Use screen-space picking and a stable ID mapping to maintain cross-view selection.

### 10.2 Explicit rendering budgets

Define practical budgets for:

- Active GPU points/instances.
- CPU and GPU memory.
- In-flight requests.
- Data pages retained in memory.
- Query concurrency.
- Maximum work per render/update frame.
- Frame time under supported hardware profiles.

When the visible data exceeds a budget, aggregate or progressively reveal records instead of freezing the interface. If the renderer samples or aggregates, disclose that state and provide counts and a way to retrieve individual records.

### 10.3 Resource lifecycle

Geometry and GPU resources must have explicit ownership. When rebuilding buffers or geometry, dispose of replaced resources rather than merely overwriting attributes on live geometry. On unmount, dispose of the current resources and remove listeners/observers.

Test repeated radius/thickness changes, frame switches, source refreshes, and unmount/remount cycles. Monitor renderer memory counters and verify that resource counts stabilize rather than increasing indefinitely.

---

## 11. User Interface and Interaction Rules

### 11.1 Shell controls

- Radius control with a clearly labeled unit.
- Full-thickness control with inner/outer radius readout.
- Optional numeric entry for precise values.
- Optional logarithmic radius scale if the useful distance range spans many orders of magnitude; provide clear labels and keyboard-accessible input.
- Separate toggles for located, uncertain, and unknown-distance classes.
- Source selection and per-source health/coverage status.
- Reset-to-default and restore-last-shell controls.
- Loading, partial-result, and query-complete indicators.

### 11.2 Interaction behavior

1. Moving the radius updates shell geometry immediately.
2. Changing thickness updates both boundaries.
3. Data queries are debounced and cancellable.
4. A new query does not reset unrelated visual settings.
5. 2D and 3D views share the same selected object ID.
6. A frame/projection change recomputes view positions, not object identity.
7. Uncertain objects expose their distance range/model and why they are in the uncertainty layer.
8. Direction-only objects remain available in directional views but are not represented as known 3D shell members.
9. Partial results are clearly distinguished from completed results.
10. A source outage does not cause already valid results from other sources to disappear without explanation.

### 11.3 Object details

The details panel should show, when available:

- Preferred display name and object class.
- Stable internal ID.
- Source catalogue names and original identifiers.
- Adopted distance, units, and quality state.
- Uncertainty interval or probability and its interpretation.
- Coordinate frame and relevant epoch.
- Source-specific metadata and links, where available.
- Provenance and normalization notes.
- Whether the object is currently loaded, discovered, aggregated, or selected from a partial query.

---

## 12. Recommended Implementation Roadmap

Deliver the system in reviewable milestones. Each milestone should be independently tested and committed only after its acceptance criteria pass.

### Milestone 1 — Pure shell mathematics and data contracts

Implement the shell state model, unit conventions, inner/outer radii, exact membership predicate, and located/uncertain/unknown data contract.

**Acceptance criteria:**

- Tests cover inner/outer boundary equality and just-inside/just-outside cases.
- Radius and thickness validation is explicit.
- Thickness larger than twice the radius clamps the inner radius to zero.
- Unit conversion and invalid/unknown units are tested.
- Missing, invalid, and uncertain distances are classified deterministically.
- Interval overlap and posterior-based membership are tested with appropriate fixtures.
- The module is pure and has no renderer or network dependency.
- No UI behavior changes in this milestone.

### Milestone 2 — One real catalogue end-to-end

Select a catalogue that provides suitable spatial/distance information and can be queried under practical constraints. Validate its schema, coordinate frame, distance semantics, units, quality flags, and licensing/access constraints.

**Acceptance criteria:**

- Source records normalize without losing provenance.
- Known sample positions and distances are independently validated.
- Uncertain and unknown cases are classified correctly.
- Stable IDs and source identifiers survive normalization.
- Duplicate handling is explicit, even if full cross-matching is deferred.
- The source's coverage and limitations are documented.

### Milestone 3 — Spatial query service

Implement conservative candidate retrieval, exact filtering, pagination, cancellation, and caching.

**Acceptance criteria:**

- Candidate retrieval is checked against a brute-force reference set for manageable fixtures.
- No true shell members are omitted by the candidate query.
- Exact boundary behavior is stable.
- Pagination does not duplicate or omit records.
- Rapid query changes cannot overwrite newer results.
- Cache keys include all data-affecting query inputs.
- Empty, partial, failed, and complete results have distinct states.

### Milestone 4 — Shell controls and linked views

Add shell controls to Observe and render the inner/outer boundaries. Integrate located and uncertain layers and retain stable-ID selection between the 2D and 3D views.

**Acceptance criteria:**

- Radius/thickness changes update shell geometry correctly.
- Data results reflect the selected band after query completion.
- Selection is consistent across both views.
- Frame and projection changes do not mutate canonical records.
- Uncertain and unknown layers cannot be mistaken for definite shell membership.
- Existing Observe behavior remains functional.
- Mode A files and behavior remain unchanged.

### Milestone 5 — Scale and performance

Add instancing, level of detail, progressive loading, spatial chunk caching, and diagnostics.

**Acceptance criteria:**

- Synthetic large datasets remain responsive within documented budgets.
- No uncontrolled growth in GPU resources during repeated updates.
- Unmount/remount leaves no canvases, listeners, observers, or owned resources behind.
- Sampling/aggregation is disclosed to the user.
- Selection can resolve a real record even when its visual representation is aggregated.
- Mobile WebGL and desktop performance are measured separately.

### Milestone 6 — Multi-source expansion

Add further catalogues incrementally, each with a documented adapter and capability record.

**Acceptance criteria:**

- Source failures are isolated.
- Source coverage and query status are visible.
- Provenance survives cross-source aggregation.
- Cross-matching is auditable and reversible or traceable.
- Source-specific uncertainty semantics are respected.
- The interface does not claim complete coverage when a source is unavailable or a query is partial.

---

## 13. Test Plan

| Area | Required tests |
|---|---|
| Shell geometry | Radius zero, inner-radius clamp, inclusive boundaries, invalid inputs |
| Units | Light-years/parsecs conversion, unit normalization, unknown units |
| Coordinates | Frame conversions through the shared core, origin semantics, unit-vector/position checks |
| Distances | Missing values, invalid values, quality flags, adopted distance policy |
| Uncertainty | Interval overlap, credible/confidence semantics, posterior integration, threshold handling |
| Query completeness | Candidate index versus brute-force results, boundary cases, broad/thin shells |
| Pagination | Duplicate pages, missing cursors, source failures, continuation correctness |
| Concurrency | Rapid radius changes, cancellation, late/stale response rejection |
| Caching | Query-key correctness, invalidation, reuse of spatial chunks |
| Linked views | Shared-ID selection, frame/projection switch, missing record, selection persistence |
| Rendering | Large data batches, LOD, picking, geometry replacement, memory stabilization |
| Cleanup | Repeated updates, unmount/remount, observers/listeners/canvases and GPU resources |
| Regression | Existing Observe behavior, Mode A navigation and performance guards |
| Provenance | Original IDs, units, frame, uncertainty, source version and coverage metadata |
| Partial coverage | Source timeout, incomplete pages, partial results, visible warnings |

Scientific correctness should not be inferred merely from a successful build or a visually plausible point cloud. Test the pure mathematics independently, then test query correctness and linked rendering.

---

## 14. Risks and Mitigations

### Risk: the shell retrieves too many records

**Mitigation:** indexed candidate retrieval, pagination, spatial chunks, aggregation, and explicit rendering budgets.

### Risk: catalogue distances have incompatible semantics

**Mitigation:** source-specific adapters, explicit units and distance semantics, validation fixtures, and documented transformation policies.

### Risk: uncertain objects look falsely precise

**Mitigation:** separate uncertainty layer, source-specific uncertainty models, visual distinction, and metadata explaining the classification.

### Risk: duplicated physical objects across catalogues

**Mitigation:** auditable cross-matching, preserved source IDs, conservative merge policies, and user-visible provenance.

### Risk: a remote source is unavailable or does not support shell queries

**Mitigation:** source capability registry, independent adapters, local index where appropriate, and visible partial-result status.

### Risk: UI slider movement triggers excessive queries

**Mitigation:** debounce, cancellation, generation keys, cache reuse, and stale-response rejection.

### Risk: GPU resources leak during repeated updates

**Mitigation:** explicit resource ownership, disposal on replacement and unmount, and repeated-toggle memory tests.

### Risk: the system claims to show every known object

**Mitigation:** report connected sources, coverage, query completion, missing-distance counts, deduplication status, and source limitations. Treat complete global coverage as an aspiration, not an unsupported guarantee.

---

## 15. Key Design Decisions to Record

1. **Origin:** Sun-centered for the first release.
2. **Geometry:** a hollow spherical volume band with configurable mean radius and full thickness.
3. **Membership:** inclusive inner and outer boundaries using a single pure predicate.
4. **Canonical data:** normalized records retain source provenance; view positions are derived without mutating canonical records.
5. **Distance policy:** located, uncertain, and unknown are distinct states.
6. **Unknown distance:** never invent a 3D position.
7. **Discovery:** indexed, bounded, paginated queries instead of downloading all records to the browser.
8. **Rendering:** progressive, budget-aware rendering with disclosed aggregation/sampling.
9. **Selection:** stable object IDs shared across 2D and 3D.
10. **Sources:** explicit capability registry and source-specific adapters.
11. **Completeness:** visible coverage and query status; no unsubstantiated “all objects” claim.
12. **Compatibility:** keep Mode A unchanged; introduce shell exploration as an Observe capability.
13. **Validation:** scientific and resource-lifecycle tests precede catalogue-scale expansion.
14. **Repository workflow:** review each milestone, preserve known-good checkpoints, and do not implement without explicit authorization.

---

## 16. Final Recommendation

Start with **Milestone 1: pure shell mathematics and the distance-quality data contract**. It is the smallest milestone that resolves the most important ambiguity: what it scientifically means for an object to belong to the shell.

Then integrate one real catalogue, prove that the spatial query is complete against a brute-force reference, and only then connect the controls and renderers. Add more archives one by one, keeping source provenance, uncertainty semantics, and coverage visible throughout.

The successful end state is not simply a hollow sphere with more points. It is a scientific exploration system where users can sweep through concentric regions of space, discover objects exposed by connected catalogues, understand which positions are uncertain or unknown, inspect source provenance, and navigate the same objects across linked 2D and 3D views.

**Recommendation:** approve the architecture as a staged design proposal, with Milestone 1 as the next implementation checkpoint. This document does not authorize repository changes.

---

## 17. Implementation status (recorded by the implementer, 2026-10-16)

> This appendix was added when the plan was placed under version control. It
> records what was actually built, what is proven by tests, and what remains. It
> does not alter the specification in §1–§16.

The shell explorer was implemented as staged, independently tested commits on
`main` (`278658c`, `40afb5a`, `f84a8ed`, `15df454`, `d58d7c5`), followed by the
correctness fixes and tests described below. Paths were reconciled with the
repository: the authoritative shell core lives in the shared package
`shared/astro/` (published internally as `@novochar/astro` and consumed by both
the server and the client) rather than the illustrative
`client/src/lib/observe/shell/` sketch in §7.3. A fourth classification,
`outside`, was added beyond the three display layers: an object with a precise
distance outside the band is excluded and is never rendered as "uncertain".

### 17.1 Milestone status

| Milestone | Status |
| --- | --- |
| 1 — Pure shell mathematics and data contracts | **Complete** |
| 2 — One real catalogue end-to-end | **Partial** — adapters and interval evidence done; no licensed, distance-bearing source enabled |
| 3 — Spatial query service | **Complete for the current sources** — linear scan, not yet a spatial index |
| 4 — Shell controls and linked views | **Complete** |
| 5 — Scale and performance | **Partial** — batched geometry and safe disposal done; no budgets, LOD or chunk cache |
| 6 — Multi-source expansion | **Not started** |

### 17.2 What is implemented

- **M1 — `shared/astro/`:** shell bounds and an inner/outer-inclusive membership
  predicate from one place (`shell.js`); canonical-unit conversion with unknown
  units rejected (`distance.js`); point/interval/posterior distance evidence and
  the located/uncertain/unknown/outside classifier (`distance-quality.js`).
  Posterior CDFs are validated to be non-decreasing and within `[0, 1]`; a
  malformed CDF returns `unknown`, never a clamped scientific claim.
- **M2 — `server/shell/sources.js`:** a source registry with capability records
  and adapters. The frame policy is applied server-side: a non-ICRS catalogue is
  reported, not silently treated as ICRS. A published parallax becomes a point
  distance; a parallax **with its error** becomes an asymmetric distance interval
  `[1/(p+σ), 1/(p−σ)]` (unbounded above when `p ≤ σ`), which is the only route
  that populates the uncertain layer.
- **M3 — `server/shell/query.js` + `GET /api/observe/shell`:** conservative
  candidate pruning, exact classification, stable-id deduplication, cursor
  pagination, per-source coverage, and HTTP caching of the response. Cursors are
  opaque tokens bound to the normalized query that produced them (band geometry,
  unit, layer policy, source selection, ordering); replaying one under a different
  query is an explicit `400 invalid-cursor` (`reason: mismatch|malformed`), never
  a silently offset page.
- **M4 — `client/src/components/Observe.jsx` and the two renderers:** shell
  radius/thickness/unit controls, layer toggles, linked 2D/3D selection by stable
  id, and a target panel with provenance and quality notes.
- **Follow-up correctness fixes:** an interval is never displayed as a single
  exact distance (it is shown as a range, and the 3D view draws a radial spoke
  spanning it); direction-only records are parked on a separately drawn, larger
  sky dome so they cannot be read as objects on the outer shell boundary; the
  client paginates, aborts superseded requests, drops out-of-order responses by
  sequence number, and — when the server refuses a cursor bound to a superseded
  query — resets to page one instead of surfacing a fatal error.

### 17.3 What remains outstanding

1. **A real distance-bearing catalogue (blocks M2/M6).** The active star source
   is still the eight-star CC0 fixture, which publishes no parallax, so the
   uncertain layer is empty end to end even though every code path for it exists
   and is tested. The BSC5 adapter is present but its FK5 frame is rejected by
   the shell adapter (no frame transform is performed), and its raw data is
   git-ignored until redistribution terms are confirmed. Enabling one licensed
   source with documented frame conversion and distance uncertainty is the next
   real step.
2. **Scale beyond a linear scan (M5).** Each query loads and scans every row of
   every selected source. The suite now cross-checks a 20 000-row synthetic
   catalogue against a brute-force reference, but there is no spatial index,
   level of detail, progressive loading or documented per-frame render budget,
   and mobile WebGL is not measured separately.
3. **Multi-source expansion (M6).** Cross-source matching, source-specific
   uncertainty semantics, and partial-coverage aggregation are unbuilt.

### 17.4 Verification

`npm test` runs the shared core, the server and the client suites plus the
generated-data consistency check; `npm run build -w client` builds the client. A
live server returns 51 members for the default band (43 located, 8
unknown-distance fixture stars, 0 uncertain), and a paged sweep of the API
returns every member exactly once.

### 17.5 Performance and browser-acceptance baseline

The audit asked for a measured performance baseline and an independent browser
acceptance pass (§8, Steps 3 and 6). Both are now reproducible, on-demand
commands — deliberately **not** part of `npm test`, because they need a browser
and their numbers are environment-specific:

| Command | What it does |
| --- | --- |
| `npm run bench:shell` | Times the real `queryShell` service over synthetic catalogues and writes a JSON report (`SHELL_BENCH_JSON=<path>` to save). |
| `npm run check:shell` | Boots the production server and asserts the shell UI in system Chromium via Playwright. |

Harnesses: `scripts/shell-benchmark.mjs` and `scripts/shell-acceptance.mjs`.

#### Server query latency

Environment: Node `v24.19.0`, linux x64, AMD Ryzen 3 3250U (4 cores), 6.1 GB
RAM; median of 5 runs. Synthetic single source, 10% of rows carry no distance,
the rest uniform in `[0, 5000]` ly. These are latencies for the **current linear
scan**, not a target.

| rows | default (R=100, T=20) | wide (R=1000, T=2000) | distant (R=10000, T=1000) |
| --- | --- | --- | --- |
| 1 000 | 0.9 ms | 1.6 ms | 0.9 ms |
| 10 000 | 11.2 ms | 13.8 ms | 6.7 ms |
| 50 000 | 23.8 ms | 34.8 ms | 30.3 ms |
| 100 000 | 31.3 ms | 75.4 ms | 57.7 ms |
| 250 000 | 59.0 ms | 270.1 ms | 144.7 ms |
| 500 000 | 129.8 ms | 335.9 ms | 233.6 ms |

Cost is linear in catalogue size (a full scan per query); repeated runs varied by
roughly ±40% on this shared 4-core machine, so treat the figures as orders of
magnitude, not constants. Supporting 1 000 000 rows costs about 300 MB of heap.

**Pagination does not reduce server work.** At 500 000 rows a first page
(`cursor=0`) and a deep page (`cursor=250000`) took 269 ms and 235 ms
respectively — both scanned all 500 000 rows. The cursor only limits the
returned slice; each page still classifies the whole source and sorts every
member. This is the concrete motivation for the M5 spatial index, which is
deferred until a realistic source exists so it can be validated against real
data rather than optimized in the abstract.

#### Browser acceptance

`npm run check:shell` passes on the built client: an unknown-distance object is
labelled direction-only and shows `unknown (direction only)`; the 3D legend
distinguishes located, `UNCERTAIN (RADIAL RANGE)` and `UNKNOWN · SKY DOME`; two
linked canvases render; a unit change converts the band (`10 pc / T 1` →
`9.50 – 10.50 pc`) rather than relabelling it; a wide band exposes `Load 300
more` and grows the on-screen count (300 → 600); the server issues an opaque
cursor, resumes the same query with it, and refuses a cursor replayed under a
different band (`invalid-cursor`); a deliberately corrupted in-flight cursor
makes the UI reset to page one (back to 300 shown) instead of failing; rapid band
changes settle on the newest query with no stale overwrite; unmounting releases
the canvases; and no uncaught page or console error occurs beyond the one generic
note for the deliberately-refused request.

Not asserted by the harness, because no active source yet provides the data:
open-ended interval labels and real uncertain radial spokes; empty, partial and
failed-source states; mobile layout; and GPU frame budgets. A separate
client-side probe measured a shell round trip (control change → response → React
commit → paint) at ~0.5–0.8 s steady state (~220 ms of which is the query
debounce), a ~5 s first heavy render when the wide band first loads ~1 700
objects, and a flat ~7 MB JS heap across repeated band changes — all under
SwiftShader **software** rendering, so the frame-time numbers are not
representative of GPU hardware.

### 17.6 Evidence boundary

The latency table and the acceptance results above were produced by the committed
harnesses in §17.5 on the machine and OS named there. They establish that the
current implementation is correct and honest for the current sources and give a
comparable starting point; they do **not** establish production-scale latency,
GPU frame budgets, real-catalogue coverage, or the validity of any source's
uncertainty model. Those remain tied to §17.3.

## 18. Catalogue decision (recorded 2026-10-16)

> Added after the plan was under version control, to unblock the M2 real-source
> step and the M5 design. It records a decision and its conditions; it does not
> enable a source and does not alter §1–§17. The full review, with verified
> sources, lives in `novochar-spherical-shell-explorer-catalogue-review.md`.

- **Primary radial source: Gaia DR3** (ESA), read as the published
  `parallax` / `parallax_error` in `gaia_source` (ICRS, reference epoch
  **J2016.0**, milliarcseconds). It is frame-native (shell frame is ICRS, so no
  transform), it carries honest distance uncertainty, and it has a stable 64-bit
  `source_id`. Distance is derived (`1000/ϖ`, interval `[1000/(ϖ+σ),
  1000/(ϖ−σ)]`), never read: Gaia publishes no distance column, and negative or
  zero parallaxes stay `unknown` (direction-only).
- **Secondary source: BSC5 (VizieR V/50)** — a bright-sky **cross-check only**.
  It is FK5/J2000 (needs a tested FK5→ICRS transform, which the current frame
  policy refuses until then) and publishes an optional parallax with **no**
  error, so it cannot populate the `uncertain` layer and must not be given a
  fabricated one.
- **Blocking gate:** Gaia data are **CC BY-NC 3.0 IGO**, and commercial use
  requires prior written ESA authorisation. The source may not be enabled until
  Novochar's use is confirmed non-commercial **or** that authorisation is
  obtained. Until then the active source stays the CC0 fixture
  (`data/catalog/PROVENANCE.md`).
- **Enablement** additionally requires a bounded, reproducible ingestion
  artifact and the acceptance criteria in the review (§5): point-vs-interval,
  open intervals, non-positive parallax → `unknown`, outside → excluded,
  frame/epoch preserved, known-record tests keyed on `source_id`, and a
  brute-force cross-check.
- **M5 stays deferred** until a real source is integrated, so the index is
  designed against measured access patterns (the current linear-scan baseline is
  §17.4) rather than a guess.
- **Owner decision (2026-10-16): stay on the fixture for now.** No Gaia
  ingestion is started; the CC BY-NC 3.0 IGO gate is recorded as an accepted,
  open risk. The review is the document to act on if the use is confirmed
  non-commercial or ESA authorisation is obtained.

