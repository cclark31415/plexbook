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
18.  The code will be hosted in Github
19.  A build pipeline will be created so pushes to github will build and push into Azure
20.  Optimize the web app for search engines
21.  Add "Buy me a diet pepsi" for venmo and paypal buttons to the bottom of the web page
22.  For the mobile app, limit the number of hours that the app can be used for unless the user buys the app after the first month.
23.  
