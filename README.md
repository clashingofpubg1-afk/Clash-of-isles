
Clash of Isles — Enhanced Web Prototype
Files included:
- index.html
- styles.css
- main.js

How to run locally:
1. Extract the zip.
2. Open index.html in a modern browser (Chrome/Edge/Firefox).
   - For mobile testing, open the folder through a simple local server (recommended):
     python3 -m http.server 8000
     Then open http://localhost:8000 in your mobile browser.
3. Title screen -> Start Game.
4. Click island to place buildings. Click buildings to upgrade. Start Raid to enter 20s mini-raid mode.
5. Use Save to store progress to localStorage, Load to restore.

Notes:
- Audio uses WebAudio synth that starts after first user gesture due to autoplay policies.
- This is a prototype for testing mechanics. For production you'd need asset replacement, server backend for multiplayer, and optimization.
  
