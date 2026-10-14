# Production readiness checks

The `Verify release candidate` GitHub Actions workflow runs the tests, both
dependency audits, a production build, and `npm run check:performance` on pull
requests and pushes to `main`. The performance check enforces raw and gzip
entry budgets, confirms heavy feature chunks remain deferred, checks that the
landing view avoids `objects.json`, and exercises catalogue deduplication,
failed-chunk retry, repeated 3D navigation, WebGL context restoration, and
responsive canvas cleanup. Its measurements are uploaded as a CI artifact.

`Verify deployed release` is a manual workflow because the repository does not
identify a production URL. Supply the deployment URL to check the returned HTML,
hashed asset paths and cache headers, the object catalogue, and the API fallback.
Supply a previous deployment URL as well to inject its HTML and entry bundle,
fail its lazy chunk request, then verify that the retry reloads and mounts the
current release. These checks require public deployment URLs (or credentials
added to the workflow separately).

Vercel cache policy is set in `vercel.json` and mirrored by the Express
production server:

- HTML revalidates on every navigation so reload picks up a new release.
- Content-hashed assets are immutable for one year.
- Precomputed data and deterministic API responses have a five-minute browser
  TTL and a one-day stale-while-revalidate window.

The local deployment probe was exercised against the production Express server.
For the stale-document simulation, the same local deployment was supplied as
both current and previous, and the harness injected a missing lazy-chunk 404
before reloading the live HTML. This validates the recovery flow, but it does
not compare two different deployed versions. No production URL was provided,
so deployed headers and CDN behavior remain unverified.

The local regression recorded a 168,788-byte entry script (54,716 bytes gzip),
no landing-page catalogue request, one catalogue request under rapid switching,
successful chunk retry, successful simulated WebGL context loss/restoration,
and zero canvases after navigation cleanup. Its post-unmount heap sample was
about 6.0 MB. These are single software-rendered browser samples, not release
thresholds or measurements from physical devices.

The mobile browser check uses emulated viewport, touch capability, and CPU
throttling. It cannot verify real touch gestures, orientation sensors, thermal
throttling, device GPU limits, or physical-device context-loss behavior. Use
the [physical-device checklist](physical-device-checklist.md) on the candidate
commit before tagging a release. Keep `v1.0.0` unchanged; create a new tag only
after both the device checks and deployment probe pass.
