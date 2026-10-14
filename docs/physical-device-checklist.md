# Physical-device release checklist

Run this checklist on the exact candidate commit before creating its release
tag. Browser emulation is useful for layout checks but does not replace these
hardware checks.

## Mobile

- Record device model, OS version, browser version, viewport/orientation, and
  available memory.
- Open the production candidate over cellular and Wi-Fi; record cold and warm
  landing loads and the first opening of each sky mode.
- Confirm touch drag and pinch/zoom in Explore Sky, including selecting an
  object. Rotate portrait to landscape and back while both modes are open.
- Enter Free-flight, verify the on-screen guidance matches available input,
  and check that the page does not depend on desktop pointer lock.
- Switch Explore / Free-flight repeatedly, then leave Sky Viewer. Check for
  frozen rendering, blank canvases, stale controls, and rising memory use.
- Background and resume the browser, lock/unlock the screen, and repeat the
  navigation check.
- If the platform can induce WebGL context loss, verify both modes recover;
  otherwise record context-loss recovery as not tested.

## Laptop

- Use a mid-range laptop with hardware acceleration enabled and record model,
  OS, browser, display scale, and power mode.
- Repeat cold/warm navigation, resize, pointer-lock movement, and at least ten
  mode transitions while watching memory and GPU utilization.
- Check browser console output and confirm canvases are released after leaving
  each mode.

Record results with the release candidate commit SHA. Do not move `v1.0.0`; tag
the candidate commit only after the physical checks and deployment probe pass.
