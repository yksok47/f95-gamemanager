# Changelog

To publish a release, add a section for the new version at the top of this file (`## 1.12.0 - YYYY-MM-DD`) and push it to `master`. The release workflow tags the version, builds every platform, and uses the section as the release notes.

## 1.12.0 - 2026-10-17

- Import games from links: paste a list of thread links to follow them all at once
- Import from F95Checker: brings over your followed games, notes, ratings, installed games, library folders, and favorite and hated tags
- Optional simplified install (Settings → Downloads → After download):
  - **Approve automatically**: finished downloads skip the review step when their content type, OS and version are already known
  - **Install after approval**: games are extracted right away and replace the older installed version. Ren'Py patches, uncensors, mods and walkthroughs are applied to the newest installed version
- New single-file portable `.exe` for Windows, next to the installer and the portable `.zip`

## 1.11.0 - 2026-10-10

Downloads overhaul

- Downloading from most providers now works with one click
- You can set the preferred order of download providers. The highest available provider on the list becomes the default for the download button
- File metadata is now shown next to download links. If another user already downloaded and catalogued a file, you will see its metadata near the link
- Cleaned up the downloads tab. By default it only shows links compatible with your OS

## 1.10.0 - 2026-10-03

- Overhauled save editor: better UI, support for objects and lists, signing of edited saves
- Support for decompiling newer versions of Ren'Py
- Parallelized Ren'Py archive extraction and script decompilation, which is now much faster
- Support for HTML games:
  - running them in the game manager's window
  - backing up saves (from the browser's local storage)

## 1.9.0 - 2026-10-01

- View and write posts in the game thread
- Multiple modals can be open at once
- Reordered page navigation

## 1.8.0 - 2026-09-24

- Manual ordering of titles in the roster
- Decluttered the top bar by removing unnecessary badges
- Faster page load times
- Caching of game context in the taskbar
- Fixed a bug that caused missed updates
- Advanced filters now stay selected when switching pages

## 1.7.0 - 2026-09-20

This update focuses on save management.

- Integrated save editor for both Ren'Py and RPGM
- Cleaned up the saves tab UI
- Cloud saves (requires a connected Google Drive account)
- User data sync for things like followed games, notes, playtime and ratings (requires a connected Google Drive account)
- More filtering options
- Quick filters

## 1.6.0 - 2026-09-19

- The app can now update itself automatically
- Improved background processes: better performance and no more blocking the UI
- Adblock for download links
- Support for ignoring threads
- Archiving games
- Library import
- Improved save importing
- Improved filtering
- The library now also tracks existing saves

## 1.5.0 - 2026-09-18

- Storage manager: see how much space your games and saves take up, and manage the files from there

## 1.4.0 - 2026-09-15

- Improved pagination
- Taskbar with game tabs
- Global Ren'Py settings
- Better update tracking and game roster
- Improved gallery
- Per-game notes
- Other fixes and small improvements

## 1.3.0 - 2026-09-13

- File management improvements: files are now categorized, so each kind can be handled differently. For example, only the game file can be installed
- Metadata tracking system. Part of the system built for P2P is reused to track information about files. It adds community information even to files downloaded from links, so you get the benefits of the "wisdom of the crowd" without needing to use P2P
- Install and uninstall uncensor patches from the app, at least for standard Ren'Py cases

## 1.2.0 - 2026-09-13

- Reworked the HTML parsers, so scraping is more reliable and extracts information more accurately
- Improved the overall UX. Many panels are now better organised and less cluttered
- Improved filters, which should now be much easier and more intuitive to use

## 1.1.0 - 2026-09-12

- P2P downloads
- Reliability improvements
- Visual polish
