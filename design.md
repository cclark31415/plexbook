1.  This will primarily be a non-drm audiobook player that streams from a Plex server
2.  Local playback is also supported.
3.  Plex authentication with JWT will be implemented as it is the newest authentication type
4.  For local playback, either individual files or a folder can be selected to add to a library.
5.  Multiple sources can be used and the local library will mix them together
6.  The local library will show book titles by default in Alphabetical order
7.  Definite or indefinite articles like "The" and "A" will not be used in sorting.
8.  For example "The Hunchback of Notre Dame" will be in the "H" books
9.  During playback, The current position will be recorded every 10 seconds.
10.  Playback position will be recorded for each title that is either not started or not finished.
11.  Chapter selection will be available in the playback UI
12.  Playback speed will be selectable in the playback UI
13.  Playback speed values will be from 0.25x to 3x in 0.25 increments
14.  Album art will be default in the playback UI
15.  If possible, have an optional audio spectrum analyzer in place of the album art.
16.  This should work as a web application and as an android application with possible iOS development in the future.
17.  The web application will run in Azure
18.  The code will be hosted in GitHub
19.  A build pipeline will be created so pushes to GitHub will build and push into Azure
20.  Optimize the web app for search engines
21.  Add "Buy me a diet pepsi" for venmo and PayPal buttons to the bottom of the web page
22.  For the mobile app, limit the number of hours that the app can be used for unless the user buys the app after the first month.
23.  Pixel 11 Pro Fold (codename: `yogi`) Screen Specifications & Responsive Adaptation:
     - **Closed Screen (Cover Display)**:
       - Physical Resolution: 1080 × 2424 px
       - Aspect Ratio: 20:9
       - Density: ~420 dpi (~2.625x scale factor)
       - Viewport Dimensions: ~412 × 924 dp
       - UI Behavior: Standard compact smartphone layout (`@media (max-width: 600px)`). Collapsed search and filter toolbar, compact 2-column book grid (`minmax(130px, 1fr)`), single-column player with centered album art (`min(340px, 75vw)`) and stacked controls.
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

