// Entry point of the browser version: the desktop app's screens with a web bridge. The bridge is
// installed first (imports run in order), so the app finds it like the desktop app's preload.
import "./web/install";
import "./main";
