// A complete example drop-in activity: "Quick Cast", a one-button timing game.
// Copy this file, rename the id and label, change the game, and load it as a script or as part of your own SillyTavern extension.
// See docs/MAKE-AN-ACTIVITY.md for everything `api` gives you.

(function () {
    const register = () => window.WorldkitActivities?.register({
        id: 'quick-cast',                 // unique; letters, numbers, dashes
        label: 'Quick Cast',
        tab: 'leisure',                   // 'leisure', 'study' or 'training'
        icon: 'fa-bullseye',              // any Font Awesome name
        blurb: 'Tap when the marker is in the zone.',
        solo: true,                       // can be played alone
        // music: 'my_loop_tag',          // optional: a looping tag from your sound map
        // energy: 10, minutes: 20,       // optional: its own energy cost and story minutes

        run(api) {
            const { win } = api;
            win.setHelp([{ title: 'The goal', text: 'Press the button when the marker is inside the green zone. Three tries.' }]);

            const root = document.createElement('div');
            root.className = 'snpc-act-setup';
            const status = document.createElement('p');
            const track = document.createElement('div');
            track.style.cssText = 'position:relative;height:28px;border:1px solid #a4947d;border-radius:8px;margin:12px 0;';
            const zone = document.createElement('div');
            zone.style.cssText = 'position:absolute;left:40%;width:20%;top:0;bottom:0;background:#3f9b5a55;';
            const marker = document.createElement('div');
            marker.style.cssText = 'position:absolute;top:0;bottom:0;width:6px;background:#c0504d;left:0;';
            track.append(zone, marker);
            const tap = document.createElement('button');
            tap.className = 'snpc-act-btn';
            tap.type = 'button';
            tap.textContent = 'Tap';
            root.append(status, track, tap);
            win.main.replaceChildren(root);

            let tries = 0;
            let hits = 0;
            let t0 = performance.now();
            let raf = 0;
            const frame = (now) => {
                const p = (((now - t0) / 1500) % 2);
                marker.style.left = `${(p <= 1 ? p : 2 - p) * 97}%`;
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
            status.textContent = 'Try 1 of 3.';

            tap.addEventListener('click', () => {
                const at = parseFloat(marker.style.left);
                const hit = at >= 40 && at <= 60;
                tries += 1;
                if (hit) hits += 1;
                api.sfx(hit ? 'activity_study_match' : 'activity_study_miss');
                api.talk('moment', { event: hit ? 'a clean hit' : 'a miss' });
                if (tries < 3) { status.textContent = `${hit ? 'Hit!' : 'Missed.'} Try ${tries + 1} of 3.`; return; }
                cancelAnimationFrame(raf);
                const grade = hits === 3 ? 'perfect' : hits === 2 ? 'good' : hits === 1 ? 'fair' : 'poor';
                api.talk('end', { outcome: grade });
                const lines = api.settle({
                    grade, levelXp: 4 + hits * 2,
                    summary: `${api.activity.label}${api.partner ? ` with ${api.partner}` : ' alone'}: ${hits} of 3 hits.`,
                    bonds: api.partner && hits >= 2 ? [{ meter: 'trust', amount: 0.5 }] : [],
                });
                api.result({ title: `${hits} of 3`, grade, lines, again: 'Cast again' });
            });
        },
    });

    // The module may load after this script; register now if it is there, else when the page is ready.
    if (window.WorldkitActivities) register();
    else window.addEventListener('load', register, { once: true });
})();
