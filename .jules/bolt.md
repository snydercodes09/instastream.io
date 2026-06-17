
## 2025-02-28 - [React Re-render Optimization]
**Learning:** `Controls.tsx` handles high-frequency updates (e.g. `currentTime` which changes multiple times per second during playback). Without memoization on the `Controls` component itself and stable callback props from the parent `KMPlayer.tsx`, the entire controls subtree re-renders unnecessarily, causing a measurable main thread load during media playback.
**Action:** When working with media player controls or any high-frequency state, always wrap the presentation component in `React.memo` and ensure all parent callbacks are strictly memoized using `useCallback`.
