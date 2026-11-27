1.  This will primarily be a non-drm audiobook player that streams from a Plex server
2.  Local playback is also supported.
3.  Plex authentication with JWT will be implemented as it is the newest authentication type
4.  For local playback, either individual files or a folder can be selected to add to a library.
5.  Multiple sources can be used and the local library will mix them together
6.  The local library will show book titles by default in Alphabetical order
7.  Definite or indefinite articles like "The" and "A" will not be used in sorting.
8.  For example "The Hunchback of Notre Dame" will be in the "H" books
9.  During playback, The current position will be recorded every 10 seconds.
10. Playback position will be recorded for each title that is either not started or not finished.
11. Chapter selection will be available in the playback UI
12. Playback speed will be selectable in the playback UI
13. Playback speed values will be from 0.25x to 3x in 0.25 increments
14. Album art will be default in the playback UI
15. If possible, have an optional audio spectrum analyzer in place of the album art.
16. This should work as a web application and as an android application with possible iOS development in the future.
17. The web application will run in Azure
18. The code will be hosted in GitHub
19. A build pipeline will be created so pushes to GitHub will build and push into Azure
20. Optimize the web app for search engines
21. Add "Buy me a diet pepsi" for venmo and PayPal buttons to the bottom of the web page
22. For the mobile app, limit the number of hours that the app can be used for unless the user buys the app after the first month.
23. Native Jetpack Media3 Android Integration (`com.chrisclark.plexbook`):
    - `PlaybackService.java`: `MediaSessionService` hosting `ExoPlayer` & `MediaSession`.
    - Notification shade and lock screen card controls featuring `-30s` rewind and `+30s` fast-forward custom buttons (`ACTION_REWIND_30`, `ACTION_FORWARD_30`).
    - Persistent foreground service (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`) maintaining background playback when minimized, swiped away, or screen locked.
24. Capacitor Native Bridge (`MediaSessionPlugin.java`):
    - Bridges JavaScript player state with native `MediaController` (`loadMedia`, `play`, `pause`, `seek`, `seekBack`, `seekForward`, `setSpeed`, `setStatusBarStyle`).
    - Emits real-time native events (`onPlaybackStateChanged`, `onTrackChanged`, `onPositionChanged`, `onDurationChanged`).
    - Handles automatic track transitions (`onMediaItemTransition`) updating current track index, saved position, and chapter dropdown.
    - Prevents transient zero-position resets during preparation/seek triggers via protected requested position state (`lastRequestedPositionMs`).
25. Real-Time Hardware PCM Audio Spectrum Visualizer (`CustomAudioProcessor`):
    - Implements an in-process Media3 `BaseAudioProcessor` inside ExoPlayer's `DefaultAudioSink` audio pipeline.
    - Intercepts 16-bit PCM audio samples directly from ExoPlayer's decoder across 32 frequency bands, bypassing Android OS dangerous runtime permission restrictions (`RECORD_AUDIO`).
    - Exposes real-time PCM amplitudes via `getFrequencyData` to Web canvas.
    - Applies power-curve dynamic scaling (`Math.pow(rawAmp * 1.8, 0.7)`) and exponential peak-decay (`0.82`) for smooth, non-clipping, vocal-reactive speech visualization.
26. Progress Bar Time Display Modes ("Total Time" vs. "Remaining Time"):
    - Preferences option (`plexbook_time_display`) allowing users to choose between Total Time and Remaining Time display on the right side of the seek bar.
    - Interactive shortcut: Tapping directly on the right time label (`#totalTime`) in the player view toggles between Total Time (e.g. `1:45:00`) and Remaining Time (e.g. `-1:32:26`) with a toast notification.
27. Pre-Launch Theme Synchronization & Zero Flash Launch:
    - Pre-launch window styling in `MainActivity.java` and native XML theme files (`styles.xml`, `values-night/styles.xml`) matching app colors (#1a1410 dark, #f4f0eb light) to prevent white screen launch flashes.
    - Dynamic window status bar and navigation bar icon color sync (`WindowInsetsControllerCompat`).
28. Startup Position & Chapter Restoration:
    - Automatically restores last played audiobook on startup (`restoreLastPlayedBook()`).
    - Pre-calculates seek bar max duration (`seekBar.max = trackDuration`) before assigning startup seek position (`seekBar.value = startTime`) to prevent HTML5 range input clamping.
29. Compact Responsive Player Sizing:
    - Responsive album art / visualizer sizing (`min(250px, 60vw, 30vh)` artwork scaling) so artwork/spectrum, title, seekbar, play controls, speed selector, and chapter selector all fit on screen without vertical clipping.
30. Pixel 11 Pro Fold (codename: `yogi`) Screen Specifications & Responsive Adaptation:
     - **Closed Screen (Cover Display)**:
       - Physical Resolution: 1080 × 2424 px
       - Aspect Ratio: 20:9
       - Density: ~420 dpi (~2.625x scale factor)
       - Viewport Dimensions: ~412 × 924 dp
       - UI Behavior: Standard compact smartphone layout (`@media (max-width: 600px)`). Collapsed search and filter toolbar, compact 2-column book grid (`minmax(130px, 1fr)`), single-column player with centered album art (`min(250px, 60vw, 30vh)`) and stacked controls.
     - **Open Screen (Inner Main Display)**:
       - Physical Resolution: 2076 × 2152 px
       - Aspect Ratio: ~1:1.04 (near-square 8.0" display)
       - Density: 390 dpi (~2.4375x scale factor)
       - Viewport Dimensions: ~852 × 883 dp in portrait/default orientation (~883 × 852 dp in landscape)
       - UI Behavior: Tablet/Foldable dual-pane layout (`@media (min-width: 700px)`).
         - Player View: Expands to a side-by-side 2-column grid (`grid-template-columns: minmax(280px, 380px) minmax(320px, 1fr)`). Left column hosts full-resolution album art or audio spectrum visualizer (up to 380px square); right column organizes book title/author, seekbar and timing, playback buttons, and speed/chapter controls.
         - Library View: 4–5 column adaptive grid (`minmax(170px, 1fr)`) with inline search and source filter toolbar.
         - Modals: Scaled modal dialogs with `max-width: 580px` for optimal viewing on square viewports.
     - **Tabletop / Flex Posture**:
       - Posture: Half-open device resting on a flat surface (hinge angle ~75° to 135°).
       - Detection: `@media (screen-posture: table-top)`, `(vertical-viewport-segments: 2)`, `(screen-spanning: single-fold-horizontal)`.
       - UI Behavior: Media viewer (album art or spectrum visualizer) constrained to upper display area (`max-height: 38vh`), while lower flat half presents playback scrubbers, controls, and selectors.
     - **Book / Vertical Hinge Posture**:
       - Posture: Unfolded book posture with vertical hinge.
       - Detection: `@media (horizontal-viewport-segments: 2)`, `(screen-spanning: single-fold-vertical)`.
       - UI Behavior: Dual-column grid respecting the physical fold hinge via `env(viewport-segment-*)`.
     - **Edge-to-Edge & Safe Area Insets**:
       - Viewport configured with `viewport-fit=cover`.
       - All views and fixed bars apply `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, and `env(safe-area-inset-right)` to prevent obstruction by camera punch holes and navigation bars.
     - **Dynamic Folding State Preservation**:
       - Android configuration changes (`orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density`) handled dynamically so opening and closing the device causes zero audio stutter, uninterrupted playback, and instant responsive CSS transition.
31. Progress Bar Scope Settings ("Current Chapter" vs. "Full Book"):
    - Preferences option (`plexbook_progress_scope`) allowing users to toggle the seek bar, timing labels, and scrubbing behavior between "Current Chapter" and "Total Book".
    - Current Chapter mode (`"chapter"`): Progress bar, elapsed time, total/remaining time, and slider scrubbing operate relative to the current active chapter boundary.
    - Total Book mode (`"book"`): Progress bar, elapsed time, total/remaining time, and slider scrubbing operate across the entire book duration and all audio tracks/files.
    - Interactive shortcut: Tapping directly on the left time label (`#currentTime`) in the player view toggles between Current Chapter progress and Total Book progress with a toast notification.
