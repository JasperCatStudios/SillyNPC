/*
 * Worldkit weather FX: the canvas engine.
 *
 * Derived from particleCanvas.js (and the sun, moon, lens flare, sunrise, sunset, night and lightning
 * overlays of weatherEffects.js / weather.css) of Doom's Enhancement Suite for SillyTavern,
 * Copyright (C) 2026 Jordan (DangerDaza), https://github.com/DangerDaza/Dooms-Enhancement-Suite
 * Doom's Enhancement Suite is originally forked from the RPG Companion Extension for SillyTavern,
 * Copyright (C) 2024 Marysia (marinara_spaghetti).
 *
 * Modified for Worldkit (JasperCatStudios, 2026): renamed, the DES perf-mode hooks removed, the DOM sky
 * overlays redrawn on the canvas, wind that bends falling particles, intensity and density scaling,
 * cross-fades between weathers, random lightning with bolts and a thunder callback, a static frame under
 * reduced motion, low-power and battery modes, and new effects (drizzle/downpour styles, sleet, hail,
 * leaves, petals, ash, embers, sand, heat haze, fog banks, clouds, aurora, rain on a window, sky tints for
 * every weather). Planning lives in weather-fx-core.js.
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU
 * Affero General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. This program is distributed in the hope that it will
 * be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have
 * received a copy of the GNU Affero General Public License along with this program (LICENSE). If not, see
 * <https://www.gnu.org/licenses/>.
 */

/*
 * HOW THE SCENE MODULE SHOULD CALL THIS (wiring is a later step; nothing here runs on import)
 *
 *   import { createWeatherFx } from './weather-fx-canvas.js';
 *   const fx = createWeatherFx({ layer: settings.scene.weatherFx.layer });   // 'behind' (default) | 'front'
 *   fx.setDensity(settings.scene.weatherFx.density);                         // 0-100, default 100
 *   fx.setLowPower(settings.scene.weatherFx.lowPower);                       // manual low-power switch
 *   fx.setEnabled(settings.scene.weatherFx.enabled);                         // off by default
 *   const stop = fx.onThunder(p => sound.thunder(p));                        // optional, for the SOUND module
 *
 *   // On the planned 'worldkit-scene-changed' event (and once at start-up / chat change):
 *   document.addEventListener('worldkit-scene-changed', (e) => {
 *       const s = e.detail;   // the scene module's current scene
 *       fx.setWeather({
 *           kind: s.weatherKind,          // a kind of src/weather-kind.js, or an extra kind (fog, sleet, hail, ...)
 *           word: s.weatherWord,          // the word the detector matched ("sleet", "drizzle"): refines the kind
 *           intensity: s.weatherIntensity, // 1-5 or 'light' | 'moderate' | 'heavy'
 *           windSpeed: s.windSpeed,       // km/h or a word ('breeze', 'gale'); optional
 *           windDirection: s.windDirection, // degrees or compass the wind comes FROM, or 'left' | 'right'; optional
 *           timeOfDay: s.timeOfDay,       // dawn | day | dusk | night; or give hour
 *           hour: s.hour,                 // 0-23, places the sun and moon; optional
 *           season: s.season,             // spring | summer | autumn | winter; optional
 *           indoor: s.place?.indoor,      // true: no precipitation, rain on a window instead
 *           moonPhase: s.moonPhase,       // 0 new, 0.5 full, 1 new; optional
 *       });
 *   });
 *
 *   // When the module is switched off or the extension unloads:
 *   fx.destroy();
 *
 * Thunder payload (see thunderPayload in weather-fx-core.js):
 *   { type:'thunder', flashAt, thunderAt, thunderDelayMs, distanceKm, strength 0-1, flashes, indoor, flash }
 *   flashAt / thunderAt are performance.now() times; play the thunder at thunderAt.
 */

import {
    planWeather, planTransition, nextThunder, thunderPayload, boltPath, deviceScale,
    RAIN_REF_SPEED, WIND_MAX_PUSH, DEFAULT_FADE_MS,
} from './weather-fx-core.js';

const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Sideways push in px/s for this screen, including the current gust. */
function pushOf(cfg, env, h) {
    return (cfg.windPush || 0) * env.gust * (h / 900);
}

/** Wrap a particle that the wind carried off one side back onto the other. */
function wrapX(p, w, margin) {
    if (p.x > w + margin) p.x -= w + margin * 2;
    else if (p.x < -margin) p.x += w + margin * 2;
}

/** A particle spawned above the screen, spread so a slanted fall still covers the whole width. */
function topSpawnX(w) {
    return rand(-w * 0.1, w * 1.1);
}

/*
 * The drawers. One per effect of weather-fx-core.js (EFFECTS), with the same key. Each has
 *   spawn(w, h, initial, index, cfg) -> particle      (initial: spread over the screen on first fill)
 *   step(p, dt, w, h, cfg, env)                        (moves it; recycles it when it leaves)
 *   draw(ctx, p, w, h, cfg, env)                       (env.alpha is the layer's current opacity)
 * The DES ports keep the original motion; the new ones follow the same pattern.
 */
const DRAWERS = {
    skyTint: {
        spawn() { return {}; },
        step() {},
        draw(ctx, p, w, h, cfg) {
            if (!cfg.top) return;
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, rgba(cfg.top, cfg.top[3]));
            g.addColorStop(1, rgba(cfg.bottom, cfg.bottom[3]));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        },
    },

    aurora: {
        spawn() { return { t: rand(0, 100) }; },
        step(p, dt) { p.t += dt; },
        draw(ctx, p, w, h, cfg) {
            const colours = [[80, 255, 170], [60, 220, 200], [170, 110, 255]];
            const strength = cfg.strength ?? 1;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let b = 0; b < 3; b++) {
                const base = h * (0.16 + b * 0.07);
                const height = h * (0.18 + b * 0.04);
                const pts = [];
                for (let i = 0; i <= 24; i++) {
                    const x = (i / 24) * w;
                    const y = base + Math.sin(i * 0.45 + p.t * (0.25 + b * 0.08) + b * 2) * h * 0.035
                        + Math.sin(i * 0.17 - p.t * 0.12) * h * 0.02;
                    pts.push([x, y]);
                }
                const g = ctx.createLinearGradient(0, base - height, 0, base + h * 0.04);
                const a = (0.16 + 0.06 * Math.sin(p.t * 0.6 + b)) * strength;
                g.addColorStop(0, rgba(colours[b], 0));
                g.addColorStop(0.75, rgba(colours[b], a * 0.6));
                g.addColorStop(1, rgba(colours[b], a));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1] - height);
                for (const [x, y] of pts) ctx.lineTo(x, y - height);
                for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        },
    },

    // Port of the DES twinkling stars (band and maxOpacity options kept).
    stars: {
        spawn(w, h, initial, index, cfg) {
            return {
                x: rand(0, w),
                y: rand(0, h * (cfg?.band || 0.6)),
                size: rand(1, 3),
                phase: rand(0, TAU),
                period: rand(2, 5),
                bright: Math.random() < 0.12,
                t: 0,
            };
        },
        step(p, dt) { p.t += dt; },
        draw(ctx, p, w, h, cfg) {
            const tw = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin((p.t / p.period) * TAU + p.phase))) * (cfg.maxOpacity || 1);
            const r = p.size * (1 + 0.3 * tw) * (p.bright ? 1.8 : 1);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
            g.addColorStop(0, `rgba(255,255,255,${tw})`);
            g.addColorStop(0.4, `rgba(200,220,255,${tw * 0.8})`);
            g.addColorStop(0.7, 'rgba(200,220,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 2, 0, TAU);
            ctx.fill();
        },
    },

    // The DES CSS sun and sun glow, drawn on the canvas. It glides to a new position instead of jumping.
    sun: {
        spawn(w, h, initial, index, cfg) {
            const pos = cfg?.pos || { x: 0.5, y: 0.1 };
            return { x: pos.x * w, y: pos.y * h, t: rand(0, 10) };
        },
        step(p, dt, w, h, cfg) {
            p.t += dt;
            const pos = cfg.pos || { x: 0.5, y: 0.1 };
            const k = Math.min(1, dt * 0.8);
            p.x += (pos.x * w - p.x) * k;
            p.y += (pos.y * h - p.y) * k;
        },
        draw(ctx, p, w, h, cfg) {
            const hue = { day: [255, 240, 200], dawn: [255, 180, 120], dusk: [255, 130, 80] }[cfg.hue] || [255, 240, 200];
            const m = Math.min(w, h);
            const pulse = 1 + 0.04 * Math.sin(p.t * 0.8);
            const veil = cfg.veiled ? 0.45 : 1;
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, m * 0.22 * pulse);
            glow.addColorStop(0, rgba(hue, 0.35 * veil));
            glow.addColorStop(0.35, rgba(hue, 0.12 * veil));
            glow.addColorStop(1, rgba(hue, 0));
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, m * 0.22 * pulse, 0, TAU);
            ctx.fill();
            const r = m * 0.035;
            const disc = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            disc.addColorStop(0, `rgba(255,255,245,${0.95 * veil})`);
            disc.addColorStop(0.7, rgba(hue, 0.85 * veil));
            disc.addColorStop(1, rgba(hue, 0));
            ctx.fillStyle = disc;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.fill();
        },
    },

    // The DES CSS moon and moon glow, with a phase shadow added.
    moon: {
        spawn(w, h, initial, index, cfg) {
            const pos = cfg?.pos || { x: 0.45, y: 0.08 };
            return { x: pos.x * w, y: pos.y * h, t: rand(0, 10) };
        },
        step(p, dt, w, h, cfg) {
            p.t += dt;
            const pos = cfg.pos || { x: 0.45, y: 0.08 };
            const k = Math.min(1, dt * 0.8);
            p.x += (pos.x * w - p.x) * k;
            p.y += (pos.y * h - p.y) * k;
        },
        draw(ctx, p, w, h, cfg) {
            const m = Math.min(w, h);
            const r = m * 0.03;
            const glowR = r * (5 + 0.3 * Math.sin(p.t * 0.6));
            const glow = ctx.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, glowR);
            glow.addColorStop(0, 'rgba(220,230,255,0.22)');
            glow.addColorStop(1, 'rgba(220,230,255,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, glowR, 0, TAU);
            ctx.fill();
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.clip();
            ctx.fillStyle = 'rgba(238,238,225,0.95)';
            ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
            ctx.fillStyle = 'rgba(190,190,180,0.45)';
            for (const [dx, dy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.1]]) {
                ctx.beginPath();
                ctx.arc(p.x + dx * r, p.y + dy * r, cr * r, 0, TAU);
                ctx.fill();
            }
            // Phase: 0 new, 0.5 full, 1 new. A dark disc slides across to hide the unlit part.
            const k = (cfg.phase ?? 0.5) * 2;
            const lit = k <= 1 ? k : 2 - k;
            if (lit < 0.98) {
                const off = 2 * r * lit * (k <= 1 ? -1 : 1);
                ctx.fillStyle = 'rgba(12,16,36,0.92)';
                ctx.beginPath();
                ctx.arc(p.x + off, p.y, r * 1.02, 0, TAU);
                ctx.fill();
            }
            ctx.restore();
        },
    },

    // The DES CSS shooting star, now at random moments around every cfg.everyS seconds.
    shootingStar: {
        spawn(w, h, initial, index, cfg) {
            return { wait: rand(2, cfg?.everyS || 12), active: false, life: 0 };
        },
        step(p, dt, w, h, cfg) {
            if (!p.active) {
                p.wait -= dt;
                if (p.wait <= 0) {
                    Object.assign(p, { active: true, life: 0, x: rand(w * 0.3, w * 0.95), y: rand(0, h * 0.25),
                        vx: -w * rand(0.6, 0.9), vy: h * rand(0.2, 0.35), dur: rand(0.7, 1.1) });
                }
                return;
            }
            p.life += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.life >= p.dur) {
                const every = cfg.everyS || 12;
                Object.assign(p, { active: false, wait: rand(every * 0.6, every * 1.4) });
            }
        },
        draw(ctx, p) {
            if (!p.active) return;
            const a = Math.sin((p.life / p.dur) * Math.PI);
            const len = 0.12;
            const tx = p.x - p.vx * len;
            const ty = p.y - p.vy * len;
            const g = ctx.createLinearGradient(tx, ty, p.x, p.y);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(1, `rgba(255,255,255,${0.9 * a})`);
            ctx.strokeStyle = g;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        },
    },

    clouds: {
        spawn(w, h, initial) {
            const size = w * rand(0.14, 0.26);
            const puffs = [];
            const n = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < n; i++) {
                puffs.push([rand(-1, 1) * size, rand(-0.25, 0.2) * size, size * rand(0.45, 0.8)]);
            }
            return {
                x: initial ? rand(-size, w + size) : -size * 2,
                y: rand(-0.02, 0.3) * h,
                size,
                puffs,
                speed: rand(5, 14),
                depth: rand(0.6, 1),
            };
        },
        step(p, dt, w, h, cfg, env) {
            const push = pushOf(cfg, env, h);
            const dir = push < 0 ? -1 : 1;
            p.x += (dir * p.speed + push * 0.08) * p.depth * dt;
            wrapX(p, w, p.size * 2);
        },
        draw(ctx, p, w, h, cfg) {
            const shade = Math.min(1, cfg.shade ?? 0.4);
            const c = [Math.round(245 - 185 * shade), Math.round(245 - 181 * shade), Math.round(250 - 175 * shade)];
            const a = Math.min(0.7, 0.32 * (cfg.thick ?? 1)) * p.depth;
            for (const [dx, dy, r] of p.puffs) {
                const x = p.x + dx;
                const y = p.y + dy;
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, rgba(c, a));
                g.addColorStop(0.6, rgba(c, a * 0.55));
                g.addColorStop(1, rgba(c, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, TAU);
                ctx.fill();
            }
        },
    },

    // Port of the DES drifting light orbs.
    lightOrbs: {
        spawn(w, h) {
            return { ox: rand(w * 0.1, w * 0.9), oy: rand(h * 0.1, h * 0.9), r: rand(40, 100), phase: rand(0, TAU), period: rand(20, 30), t: 0 };
        },
        step(p, dt) { p.t += dt; },
        draw(ctx, p) {
            const a = (p.t / p.period) * TAU + p.phase;
            const x = p.ox + Math.cos(a) * 22;
            const y = p.oy + Math.sin(a * 0.7) * 18;
            const o = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(a));
            const g = ctx.createRadialGradient(x, y, 0, x, y, p.r);
            g.addColorStop(0, `rgba(255,250,230,${0.12 * o})`);
            g.addColorStop(0.4, `rgba(255,245,200,${0.06 * o})`);
            g.addColorStop(0.7, 'rgba(255,245,200,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, p.r, 0, TAU);
            ctx.fill();
        },
    },

    // Heat shimmer: the canvas cannot bend the page behind it, so it paints faint rippling bands of warm
    // light low on the screen that suggest air wobbling over hot ground.
    heatHaze: {
        spawn() { return { t: 0 }; },
        step(p, dt) { p.t += dt; },
        draw(ctx, p, w, h, cfg) {
            const s = cfg.strength ?? 1;
            const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
            g.addColorStop(0, 'rgba(255,220,170,0)');
            g.addColorStop(1, `rgba(255,220,170,${0.08 * s})`);
            ctx.fillStyle = g;
            ctx.fillRect(0, h * 0.55, w, h * 0.45);
            ctx.lineWidth = Math.max(2, h * 0.012);
            for (let b = 0; b < 9; b++) {
                const y0 = h * (0.6 + b * 0.045);
                ctx.strokeStyle = `rgba(255,245,225,${(0.03 + 0.02 * Math.sin(p.t * 2 + b)) * s})`;
                ctx.beginPath();
                for (let i = 0; i <= 32; i++) {
                    const x = (i / 32) * w;
                    const y = y0 + Math.sin(i * 0.9 + p.t * (2.2 + b * 0.3) + b) * h * 0.004 * (1 + b * 0.2);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        },
    },

    // Dense fog in layered banks, thicker toward the ground; the DES mist is the lighter version.
    fogBank: {
        spawn(w, h, initial, index = 0) {
            return {
                x: rand(-w * 0.2, w * 1.2),
                y: h * (0.5 + ((index * 0.13) % 0.45)),
                rx: w * rand(0.5, 0.9),
                ry: h * rand(0.08, 0.16),
                speed: rand(4, 12) * (index % 2 ? 1 : -1),
                base: rand(0.16, 0.28),
                phase: rand(0, TAU),
                t: 0,
            };
        },
        step(p, dt, w, h, cfg, env) {
            p.t += dt;
            p.x += (p.speed + pushOf(cfg, env, h) * 0.06) * dt;
            wrapX(p, w, p.rx);
        },
        draw(ctx, p, w, h, cfg, env, index) {
            const c = { sand: [205, 170, 115], dust: [175, 165, 145] }[cfg.hue] || [205, 210, 220];
            const thick = cfg.thick ?? 1;
            if (index === 0) {
                const wash = ctx.createLinearGradient(0, h * 0.35, 0, h);
                wash.addColorStop(0, rgba(c, 0));
                wash.addColorStop(1, rgba(c, Math.min(0.45, 0.22 * thick)));
                ctx.fillStyle = wash;
                ctx.fillRect(0, h * 0.35, w, h * 0.65);
            }
            const a = Math.min(0.5, p.base * thick * (0.8 + 0.2 * Math.sin(p.t * 0.2 + p.phase)));
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(1, p.ry / p.rx);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
            g.addColorStop(0, rgba(c, a));
            g.addColorStop(0.6, rgba(c, a * 0.5));
            g.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, p.rx, 0, TAU);
            ctx.fill();
            ctx.restore();
        },
    },

    // Port of the DES mist: wide soft clouds that breathe and sway; now thickened by intensity and nudged by wind.
    mist: {
        spawn(w, h, initial, index = 0) {
            return { cy: h * (0.15 + (index % 5) * 0.18), ry: h * 0.2, rx: w * 0.6, phase: rand(0, TAU), period: rand(15, 25),
                base: rand(0.1, 0.3), shift: 0, t: 0 };
        },
        step(p, dt, w, h, cfg, env) {
            p.t += dt;
            p.shift += pushOf(cfg, env, h) * 0.03 * dt;
            if (p.shift > w * 0.6) p.shift -= w * 1.2;
            else if (p.shift < -w * 0.6) p.shift += w * 1.2;
        },
        draw(ctx, p, w, h, cfg) {
            const cycle = Math.sin((p.t / p.period) * TAU + p.phase);
            const cx = w / 2 + cycle * w * 0.1 + p.shift;
            const o = Math.min(0.5, p.base * (0.6 + 0.4 * cycle) * (cfg.thick ?? 1));
            ctx.save();
            ctx.translate(cx, p.cy);
            ctx.scale(1, p.ry / p.rx);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
            g.addColorStop(0, `rgba(200,200,220,${o})`);
            g.addColorStop(0.7, 'rgba(200,200,220,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, p.rx, 0, TAU);
            ctx.fill();
            ctx.restore();
        },
    },

    // Port of the DES rain streaks, with three styles and a slant that follows the wind.
    rain: {
        spawn(w, h, initial, index, cfg) {
            const style = cfg?.style || 'rain';
            const s = {
                drizzle: { len: [10, 22], t: [1.1, 1.7], o: [0.25, 0.45], width: 1 },
                rain: { len: [40, 60], t: [0.5, 1.0], o: [0.5, 0.8], width: 2 },
                downpour: { len: [60, 95], t: [0.35, 0.6], o: [0.55, 0.85], width: 2.3 },
            }[style] || { len: [40, 60], t: [0.5, 1.0], o: [0.5, 0.8], width: 2 };
            return {
                x: topSpawnX(w),
                y: initial ? rand(-h, h) : rand(-100, -40),
                len: rand(s.len[0], s.len[1]),
                speed: h / rand(s.t[0], s.t[1]),
                opacity: rand(s.o[0], s.o[1]),
                width: s.width,
                vx: 0,
            };
        },
        step(p, dt, w, h, cfg, env) {
            // Every drop shares the wind's slant: sideways speed in proportion to its fall speed.
            p.vx = pushOf(cfg, env, h) * (p.speed / (RAIN_REF_SPEED * h / 900));
            p.y += p.speed * dt;
            p.x += p.vx * dt;
            wrapX(p, w, 80);
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false, 0, cfg));
        },
        draw(ctx, p) {
            const v = Math.hypot(p.vx, p.speed) || 1;
            const tx = p.x - (p.vx / v) * p.len;
            const ty = p.y - (p.speed / v) * p.len;
            const g = ctx.createLinearGradient(tx, ty, p.x, p.y);
            g.addColorStop(0, 'rgba(174,194,224,0)');
            g.addColorStop(1, `rgba(174,194,224,${p.opacity})`);
            ctx.strokeStyle = g;
            ctx.lineWidth = p.width;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        },
    },

    // Half-frozen rain: short pale streaks mixed with small ice pellets.
    sleet: {
        spawn(w, h, initial) {
            return { x: topSpawnX(w), y: initial ? rand(-h, h) : rand(-40, -10), pellet: Math.random() < 0.5,
                len: rand(8, 16), r: rand(1.2, 2.4), speed: h / rand(0.8, 1.3), opacity: rand(0.45, 0.8), vx: 0 };
        },
        step(p, dt, w, h, cfg, env) {
            p.vx = pushOf(cfg, env, h) * (p.speed / (RAIN_REF_SPEED * h / 900));
            p.y += p.speed * dt;
            p.x += p.vx * dt;
            wrapX(p, w, 60);
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            if (p.pellet) {
                ctx.fillStyle = `rgba(235,242,255,${p.opacity})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, TAU);
                ctx.fill();
                return;
            }
            const v = Math.hypot(p.vx, p.speed) || 1;
            ctx.strokeStyle = `rgba(215,228,245,${p.opacity})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(p.x - (p.vx / v) * p.len, p.y - (p.speed / v) * p.len);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        },
    },

    // Hailstones: fast white pellets that bounce once near the bottom of the screen.
    hail: {
        spawn(w, h, initial) {
            return { x: topSpawnX(w), y: initial ? rand(-h, h) : rand(-40, -10), r: rand(1.6, 3.6), speed: h / rand(0.45, 0.7),
                floor: h - rand(0, h * 0.08), vy: 0, bounced: false, opacity: rand(0.65, 0.95) };
        },
        step(p, dt, w, h, cfg, env) {
            const push = pushOf(cfg, env, h);
            if (!p.bounced) {
                p.y += p.speed * dt;
                p.x += push * (p.speed / (RAIN_REF_SPEED * h / 900)) * dt;
                if (p.y >= p.floor) {
                    p.bounced = true;
                    p.vy = -p.speed * rand(0.12, 0.25);
                    p.vx = rand(-60, 60) + push * 0.2;
                }
            } else {
                p.vy += 2200 * dt;
                p.y += p.vy * dt;
                p.x += p.vx * dt;
                p.opacity -= dt * 1.5;
            }
            wrapX(p, w, 40);
            if (p.y > h + 10 || p.opacity <= 0) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            ctx.fillStyle = `rgba(240,246,255,${Math.max(0, p.opacity)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, TAU);
            ctx.fill();
        },
    },

    // Port of the DES snowflake glyphs ('flakes'); 'dense' draws soft dots, cheaper for blizzards. Wind carries both.
    snow: {
        spawn(w, h, initial, index, cfg) {
            const dense = cfg?.style === 'dense';
            return {
                x: topSpawnX(w),
                y: initial ? rand(-h, h) : rand(-40, -10),
                size: dense ? rand(1.5, 4) : rand(8, 19),
                speed: h / (dense ? rand(4, 8) : rand(10, 20)),
                drift: rand(-12, 12),
                sway: rand(0, TAU),
                spin: rand(0.3, 1) * (Math.random() < 0.5 ? -1 : 1),
                angle: rand(0, TAU),
                opacity: rand(0.5, 0.85),
                dense,
            };
        },
        step(p, dt, w, h, cfg, env) {
            p.sway += dt;
            p.y += p.speed * dt;
            p.x += (p.drift + Math.sin(p.sway) * 8 + pushOf(cfg, env, h) * 0.8) * dt;
            p.angle += p.spin * dt;
            wrapX(p, w, 30);
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false, 0, cfg));
        },
        draw(ctx, p, w, h, cfg, env) {
            if (p.dense) {
                ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, TAU);
                ctx.fill();
                return;
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.globalAlpha = env.alpha * p.opacity;
            ctx.fillStyle = 'white';
            ctx.shadowColor = 'rgba(255,255,255,0.8)';
            ctx.shadowBlur = 5;
            ctx.font = `${p.size}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❄', 0, 0);
            ctx.restore();
        },
    },

    // Volcanic ash: grey flakes tumbling slowly down.
    ash: {
        spawn(w, h, initial) {
            return { x: topSpawnX(w), y: initial ? rand(-h, h) : rand(-30, -10), size: rand(1.5, 4), speed: h / rand(14, 26),
                sway: rand(0, TAU), spin: rand(-2, 2), angle: rand(0, TAU), light: Math.random() < 0.4, opacity: rand(0.4, 0.8) };
        },
        step(p, dt, w, h, cfg, env) {
            p.sway += dt * 0.8;
            p.angle += p.spin * dt;
            p.y += p.speed * dt;
            p.x += (Math.sin(p.sway) * 14 + pushOf(cfg, env, h) * 0.7) * dt;
            wrapX(p, w, 30);
            if (p.y > h + 10) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.light ? `rgba(175,170,165,${p.opacity})` : `rgba(95,90,88,${p.opacity})`;
            ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
            ctx.restore();
        },
    },

    // Blowing sand or dust: fast low streaks carried by a strong wind.
    sand: {
        spawn(w, h, initial, index, cfg) {
            return { x: initial ? rand(0, w) : rand(-w * 0.1, w * 1.1), y: rand(0, h), len: rand(2, 7), speed: rand(0.7, 1.3),
                wob: rand(0, TAU), opacity: rand(0.25, 0.6), c: cfg?.hue === 'dust' ? [180, 170, 150] : [212, 180, 122] };
        },
        step(p, dt, w, h, cfg, env) {
            let push = pushOf(cfg, env, h);
            if (Math.abs(push) < 120) push = push < 0 ? -120 : 120;
            p.wob += dt * 3;
            p.vx = push * 1.5 * p.speed;
            p.x += p.vx * dt;
            p.y += Math.sin(p.wob) * 20 * dt;
            wrapX(p, w, 20);
            if (p.y < -5 || p.y > h + 5) p.y = rand(0, h);
        },
        draw(ctx, p) {
            const dir = p.vx < 0 ? -1 : 1;
            ctx.strokeStyle = rgba(p.c, p.opacity);
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(p.x - dir * p.len * 2, p.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        },
    },

    // Falling leaves: they sway, flip and follow the wind. Autumn colours, or greens outside autumn.
    leaves: {
        spawn(w, h, initial, index, cfg) {
            const autumn = [[200, 90, 30], [222, 142, 42], [170, 58, 30], [192, 160, 52], [150, 80, 40]];
            const green = [[90, 140, 60], [120, 160, 70], [70, 120, 50]];
            return { x: topSpawnX(w), y: initial ? rand(-h, h) : rand(-40, -15), size: rand(7, 14), speed: h / rand(9, 15),
                sway: rand(0, TAU), swayAmp: rand(25, 60), flip: rand(1.5, 3.5), angle: rand(0, TAU), spin: rand(-1.5, 1.5),
                c: pick(cfg?.season && cfg.season !== 'autumn' ? green : autumn), t: 0 };
        },
        step(p, dt, w, h, cfg, env) {
            p.t += dt;
            p.sway += dt * 1.2;
            p.angle += p.spin * dt;
            p.y += p.speed * dt;
            p.x += (Math.cos(p.sway) * p.swayAmp + pushOf(cfg, env, h) * 0.9) * dt;
            wrapX(p, w, 40);
            if (p.y > h + 30) Object.assign(p, this.spawn(w, h, false, 0, cfg));
        },
        draw(ctx, p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.scale(Math.cos(p.t * p.flip) || 0.05, 1);
            ctx.fillStyle = rgba(p.c, 0.85);
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(80,40,20,0.5)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(-p.size, 0);
            ctx.lineTo(p.size, 0);
            ctx.stroke();
            ctx.restore();
        },
    },

    // Blossom petals: small pink petals fluttering down.
    petals: {
        spawn(w, h, initial) {
            const colours = [[255, 190, 210], [255, 215, 228], [248, 170, 200], [255, 235, 240]];
            return { x: topSpawnX(w), y: initial ? rand(-h, h) : rand(-30, -10), size: rand(4, 8), speed: h / rand(11, 18),
                sway: rand(0, TAU), swayAmp: rand(20, 45), flip: rand(2, 4), angle: rand(0, TAU), spin: rand(-2, 2),
                c: pick(colours), t: 0 };
        },
        step(p, dt, w, h, cfg, env) {
            p.t += dt;
            p.sway += dt * 1.6;
            p.angle += p.spin * dt;
            p.y += p.speed * dt;
            p.x += (Math.sin(p.sway) * p.swayAmp + pushOf(cfg, env, h)) * dt;
            wrapX(p, w, 30);
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.scale(1, Math.abs(Math.cos(p.t * p.flip)) * 0.8 + 0.2);
            ctx.fillStyle = rgba(p.c, 0.9);
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.quadraticCurveTo(p.size * 0.9, 0, 0, p.size);
            ctx.quadraticCurveTo(-p.size * 0.9, 0, 0, -p.size);
            ctx.fill();
            ctx.restore();
        },
    },

    // Port of the DES wind streaks; they now blow the way the wind does and faster when it is stronger.
    wind: {
        spawn(w, h, initial, index, cfg) {
            const side = (cfg?.windPush || 0) < 0 ? -1 : 1;
            const strength = Math.min(1, Math.abs(cfg?.windPush || WIND_MAX_PUSH * 0.4) / WIND_MAX_PUSH);
            const start = side > 0 ? rand(-180, -80) : rand(w + 80, w + 180);
            return {
                x: initial ? rand(-100, w + 100) : start,
                y: rand(0, h),
                len: rand(60, 100),
                speed: ((w + 200) / rand(1.5, 2.5)) * (0.6 + 0.8 * strength),
                opacity: rand(0.4, 0.7),
                side,
            };
        },
        step(p, dt, w, h, cfg, env) {
            p.x += p.side * p.speed * env.gust * dt;
            if (p.x > w + 120 || p.x < -120) Object.assign(p, this.spawn(w, h, false, 0, cfg));
        },
        draw(ctx, p) {
            const x2 = p.x + p.side * p.len;
            const g = ctx.createLinearGradient(p.x, p.y, x2, p.y);
            g.addColorStop(0, 'rgba(200,200,220,0)');
            g.addColorStop(0.5, `rgba(200,200,220,${p.opacity})`);
            g.addColorStop(1, 'rgba(200,200,220,0)');
            ctx.strokeStyle = g;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(x2, p.y - p.len * 0.36);
            ctx.stroke();
        },
    },

    // Drifting embers: glowing sparks rising from below and flickering out.
    embers: {
        spawn(w, h, initial) {
            return { x: rand(0, w), y: initial ? rand(h * 0.2, h + 10) : h + rand(5, 30), r: rand(1.2, 3.2), rise: rand(30, 75),
                top: h * rand(0.05, 0.55), sway: rand(0, TAU), flick: rand(6, 14), t: rand(0, 5) };
        },
        step(p, dt, w, h, cfg, env) {
            p.t += dt;
            p.sway += dt;
            p.y -= p.rise * dt;
            p.x += (Math.sin(p.sway * 1.3) * 18 + pushOf(cfg, env, h) * 0.5) * dt;
            wrapX(p, w, 20);
            if (p.y < p.top) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p, w, h) {
            const fade = Math.min(1, (p.y - p.top) / (h * 0.15));
            const a = Math.max(0, fade * (0.6 + 0.4 * Math.sin(p.t * p.flick)));
            if (a <= 0) return;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
            g.addColorStop(0, `rgba(255,235,160,${a})`);
            g.addColorStop(0.35, `rgba(255,150,50,${a * 0.7})`);
            g.addColorStop(1, 'rgba(255,90,20,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 3, 0, TAU);
            ctx.fill();
        },
    },

    // Port of the DES dust motes: warm specks drifting up and fading.
    dustMotes: {
        spawn(w, h) {
            return { ox: rand(0, w), oy: rand(0, h), size: rand(2, 6), phase: rand(0, 1), period: rand(12, 20), t: 0 };
        },
        step(p, dt, w, h) {
            p.t += dt;
            if (p.t >= p.period) Object.assign(p, this.spawn(w, h), { t: 0 });
        },
        draw(ctx, p) {
            const prog = ((p.t / p.period) + p.phase) % 1;
            const x = p.ox + prog * 60;
            const y = p.oy - prog * 100;
            const o = Math.min(1, Math.sin(prog * Math.PI) * 1.4) * 0.8;
            if (o <= 0) return;
            const r = p.size * (1 + 0.2 * Math.sin(prog * Math.PI));
            const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
            g.addColorStop(0, `rgba(255,250,220,${o * 0.9})`);
            g.addColorStop(0.5, `rgba(255,235,180,${o * 0.6})`);
            g.addColorStop(1, 'rgba(255,220,150,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        },
    },

    // Port of the DES fireflies: green glows that wander upward, blinking.
    fireflies: {
        spawn(w, h) {
            return { ox: rand(0, w), oy: h * rand(0.4, 0.95), phase: rand(0, 1), period: rand(8, 15), t: 0 };
        },
        step(p, dt, w, h) {
            p.t += dt;
            if (p.t >= p.period) Object.assign(p, this.spawn(w, h), { t: 0 });
        },
        draw(ctx, p) {
            const prog = ((p.t / p.period) + p.phase) % 1;
            const x = p.ox + Math.sin(prog * TAU * 2.5) * 12;
            const y = p.oy - prog * 80;
            const o = Math.sin(prog * Math.PI) * (0.55 + 0.45 * Math.sin(prog * TAU * 3));
            if (o <= 0) return;
            const g = ctx.createRadialGradient(x, y, 0, x, y, 8);
            g.addColorStop(0, `rgba(200,255,150,${o})`);
            g.addColorStop(0.3, `rgba(180,255,120,${o * 0.8})`);
            g.addColorStop(0.6, `rgba(150,230,100,${o * 0.4})`);
            g.addColorStop(1, 'rgba(150,230,100,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, TAU);
            ctx.fill();
        },
    },

    // The lightning flash (DES used a looping CSS flash); strikes now come from the thunder schedule
    // (env.flash), with a jagged bolt for strong, close strikes. Indoors the flash is softer and boltless.
    lightning: {
        spawn() { return {}; },
        step() {},
        draw(ctx, p, w, h, cfg, env) {
            const f = env.flash;
            if (!f) return;
            const since = env.now - f.start;
            let b = 0;
            for (const fl of f.ev.flashes) {
                const local = since - fl.offsetMs;
                if (local < 0 || local > 220) continue;
                const shape = local < 30 ? local / 30 : 1 - (local - 30) / 190;
                b = Math.max(b, fl.peak * shape);
            }
            if (b <= 0) return;
            const indoor = !!cfg.indoor;
            ctx.fillStyle = `rgba(210,225,255,${(indoor ? 0.22 : 0.5) * b})`;
            ctx.fillRect(0, 0, w, h);
            if (!indoor && f.bolt) {
                ctx.save();
                ctx.strokeStyle = `rgba(245,248,255,${Math.min(1, b * 1.2)})`;
                ctx.shadowColor = 'rgba(180,200,255,0.9)';
                ctx.shadowBlur = 14;
                ctx.lineJoin = 'round';
                const line = (pts, width) => {
                    ctx.lineWidth = width;
                    ctx.beginPath();
                    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.stroke();
                };
                line(f.bolt.main, 2.6);
                for (const br of f.bolt.branches) line(br, 1.2);
                ctx.restore();
            }
        },
    },

    // The DES CSS lens flare, drawn as soft rings on the line from the sun through the screen centre.
    lensFlare: {
        spawn() { return { t: rand(0, 10) }; },
        step(p, dt) { p.t += dt; },
        draw(ctx, p, w, h, cfg) {
            const pos = cfg.pos || { x: 0.5, y: 0.1 };
            const sx = pos.x * w;
            const sy = pos.y * h;
            const dx = w / 2 - sx;
            const dy = h / 2 - sy;
            const m = Math.min(w, h);
            const pulse = 0.8 + 0.2 * Math.sin(p.t * 0.5);
            const rings = [[0.35, 0.05, [255, 220, 180], 0.08], [0.6, 0.025, [180, 220, 255], 0.1], [0.85, 0.07, [255, 200, 255], 0.05],
                [1.2, 0.035, [200, 255, 220], 0.07], [1.5, 0.09, [255, 230, 190], 0.04]];
            for (const [k, r, c, a] of rings) {
                const x = sx + dx * k * 2;
                const y = sy + dy * k * 2;
                const rr = m * r;
                const g = ctx.createRadialGradient(x, y, rr * 0.2, x, y, rr);
                g.addColorStop(0, rgba(c, a * pulse));
                g.addColorStop(0.8, rgba(c, a * pulse * 0.6));
                g.addColorStop(1, rgba(c, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(x, y, rr, 0, TAU);
                ctx.fill();
            }
        },
    },

    // Rain on a window (indoors): beads gather on the glass, and the bigger ones run down leaving a trail.
    windowRain: {
        spawn(w, h, initial, index, cfg) {
            const icy = cfg?.style === 'icy';
            const big = cfg?.style === 'downpour' ? 1.3 : cfg?.style === 'drizzle' ? 0.7 : 1;
            return { x: rand(0, w), y: initial ? rand(0, h) : rand(0, h * 0.7), r: rand(1.2, 3.6) * big * (icy ? 0.7 : 1),
                life: rand(1.5, 8), running: false, vy: 0, trail: [], icy };
        },
        step(p, dt, w, h, cfg, env) {
            if (!p.running) {
                p.life -= dt;
                if (p.life > 0) return;
                if (p.r > 2.4 && !p.icy) {
                    p.running = true;
                    p.vy = rand(50, 140);
                    return;
                }
                Object.assign(p, this.spawn(w, h, false, 0, cfg));
                return;
            }
            p.y += p.vy * dt;
            p.x += (Math.sin(p.y * 0.05) * 6 + (cfg.windPush || 0) * env.gust * 0.01) * dt;
            const last = p.trail[p.trail.length - 1];
            if (!last || Math.abs(last[1] - p.y) > 6) {
                p.trail.push([p.x, p.y]);
                if (p.trail.length > 14) p.trail.shift();
            }
            if (p.y > h + 10) Object.assign(p, this.spawn(w, h, false, 0, cfg));
        },
        draw(ctx, p, w, h, cfg, env, index) {
            if (index === 0) {
                ctx.fillStyle = p.icy ? 'rgba(200,215,235,0.07)' : 'rgba(120,140,170,0.06)';
                ctx.fillRect(0, 0, w, h);
            }
            if (p.running && p.trail.length > 1) {
                ctx.strokeStyle = 'rgba(200,215,235,0.16)';
                ctx.lineWidth = p.r * 0.8;
                ctx.lineCap = 'round';
                ctx.beginPath();
                p.trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            ctx.fillStyle = p.icy ? 'rgba(235,242,255,0.4)' : 'rgba(190,205,225,0.28)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, TAU);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.beginPath();
            ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.35, 0, TAU);
            ctx.fill();
        },
    },
};

/* ------------------------------------------------------------------------------------------------ */
/* Engine                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

class WorldkitWeatherFx {
    constructor(options = {}) {
        this.layerMode = options.layer === 'front' ? 'front' : 'behind';
        this.enabled = false;
        this.desc = null;
        this.density = 100;
        this.lowPowerManual = false;
        this.batteryLow = false;
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;
        /** id -> { effect, cfg, alpha, target, rate, removing, pool, targetCount, z } */
        this.layers = new Map();
        this.order = [];
        this.plan = null;
        this.raf = null;
        this.lastTs = 0;
        this.lastDraw = 0;
        this.env = { t: 0, gust: 1, now: 0, alpha: 1, flash: null };
        this.thunderTimer = null;
        this.thunderListeners = new Set();
        this.resizeTimer = null;
        this.battery = null;
        this.listening = false;

        this.onVisibility = () => {
            this.sync();
            this.scheduleThunder();
        };
        this.onResize = () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => this.resize(), 150);
        };
        this.onMotion = () => this.apply(0);
        this.onBattery = () => {
            const b = this.battery;
            const low = !!b && !b.charging && b.level <= 0.2;
            if (low !== this.batteryLow) {
                this.batteryLow = low;
                this.apply(DEFAULT_FADE_MS / 2);
            }
        };
        this.motionQuery = typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    }

    /* ---- settings ---- */

    reducedMotion() {
        return !!this.motionQuery?.matches;
    }

    lowPower() {
        return this.lowPowerManual || this.batteryLow || !!navigator.connection?.saveData;
    }

    settings() {
        return {
            density: this.density,
            lowPower: this.lowPower(),
            deviceScale: deviceScale({ width: window.innerWidth, height: window.innerHeight, cores: navigator.hardwareConcurrency }),
            reducedMotion: this.reducedMotion(),
            layer: this.layerMode,
        };
    }

    /* ---- lifecycle ---- */

    mount() {
        if (this.canvas) return;
        const c = document.createElement('canvas');
        c.className = 'worldkit-weather-fx';
        c.setAttribute('aria-hidden', 'true');
        // Above the chat background (#bg1 sits at z-index -1), below the chat (#sheld at 30); 'front' goes over it.
        Object.assign(c.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: this.layerMode === 'front' ? '9998' : '1',
        });
        c.style.height = '100dvh';
        if (!c.style.height) c.style.height = '100vh';
        document.body.appendChild(c);
        this.canvas = c;
        this.ctx = c.getContext('2d');
        this.resize(true);
    }

    listen(on) {
        if (on === this.listening) return;
        this.listening = on;
        const fn = on ? 'addEventListener' : 'removeEventListener';
        document[fn]('visibilitychange', this.onVisibility);
        window[fn]('resize', this.onResize);
        this.motionQuery?.[fn]?.('change', this.onMotion);
        if (this.battery) {
            this.battery[fn]('levelchange', this.onBattery);
            this.battery[fn]('chargingchange', this.onBattery);
        }
        if (on && !this.battery && typeof navigator.getBattery === 'function') {
            navigator.getBattery().then((b) => {
                if (!this.listening || this.battery) return;
                this.battery = b;
                b.addEventListener('levelchange', this.onBattery);
                b.addEventListener('chargingchange', this.onBattery);
                this.onBattery();
            }).catch(() => {});
        }
    }

    resize(skipApply = false) {
        if (!this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, this.lowPower() ? 1 : 2);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Sizes and positions come from the screen, so refill every pool for the new size.
        for (const layer of this.layers.values()) layer.pool = this.fill(layer, layer.targetCount, true);
        if (!skipApply) this.apply(400);
    }

    fill(layer, count, initial) {
        const drawer = DRAWERS[layer.effect];
        const pool = [];
        for (let i = 0; i < count; i++) pool.push(drawer.spawn(this.width, this.height, initial, i, layer.cfg));
        return pool;
    }

    /* ---- planning ---- */

    /** Re-plan from the current description and settings and cross-fade to it. */
    apply(fadeMs = DEFAULT_FADE_MS) {
        if (!this.enabled || !this.canvas) return;
        const plan = this.desc ? planWeather(this.desc, this.settings()) : { layers: [], thunder: { enabled: false }, frameMs: 0 };
        const prev = [...this.layers.entries()].filter(([, l]) => !l.removing)
            .map(([id, l]) => ({ id, count: l.targetCount, alpha: l.target, opts: l.cfg }));
        const trans = planTransition(prev, plan.layers, this.reducedMotion() ? 0 : fadeMs);
        const rate = trans.durationMs > 0 ? 1000 / trans.durationMs : Infinity;
        const byId = new Map(plan.layers.map(l => [l.id, l]));
        for (const id of trans.fadeOut) {
            const l = this.layers.get(id);
            Object.assign(l, { target: 0, rate, removing: true });
        }
        for (const id of trans.fadeIn) {
            const n = byId.get(id);
            const old = this.layers.get(id); // one still fading out from an earlier change
            const layer = { effect: n.effect, cfg: { ...n.opts }, alpha: old ? old.alpha : 0, target: n.alpha, rate,
                removing: false, targetCount: n.count, z: n.z, pool: [] };
            layer.pool = old && old.pool.length ? old.pool : this.fill(layer, n.count, true);
            while (layer.pool.length < n.count) {
                layer.pool.push(DRAWERS[n.effect].spawn(this.width, this.height, false, layer.pool.length, layer.cfg));
            }
            if (rate === Infinity) layer.alpha = n.alpha;
            this.layers.set(id, layer);
        }
        for (const r of trans.retune) {
            const l = this.layers.get(r.id);
            Object.assign(l, { cfg: { ...r.to.opts }, target: r.to.alpha, rate, targetCount: r.to.count });
            while (l.pool.length < l.targetCount) {
                l.pool.push(DRAWERS[l.effect].spawn(this.width, this.height, false, l.pool.length, l.cfg));
            }
            if (rate === Infinity) l.alpha = l.target;
        }
        if (rate === Infinity) for (const id of trans.fadeOut) this.layers.delete(id);
        this.order = [...this.layers.keys()].sort((a, b) => this.layers.get(a).z - this.layers.get(b).z);
        this.plan = plan;
        this.scheduleThunder();
        this.sync();
    }

    /* ---- thunder ---- */

    scheduleThunder() {
        clearTimeout(this.thunderTimer);
        this.thunderTimer = null;
        if (!this.enabled || !this.plan?.thunder?.enabled || document.hidden) return;
        const ev = nextThunder(Math.random, this.plan.thunder.intensity, 0);
        this.thunderTimer = setTimeout(() => this.strike(ev), ev.atMs);
    }

    strike(ev) {
        this.thunderTimer = null;
        if (!this.enabled || !this.plan?.thunder?.enabled) return;
        const flashAt = performance.now();
        const showFlash = !this.reducedMotion() && this.layers.has('lightning') && !this.layers.get('lightning').removing;
        if (showFlash) {
            this.env.flash = { start: flashAt, ev, bolt: ev.bolt ? boltPath(ev.boltSeed, this.width, this.height) : null };
        }
        const payload = thunderPayload(ev, flashAt, { indoor: !!this.plan.thunder.indoor, flash: showFlash });
        for (const cb of this.thunderListeners) {
            try {
                cb(payload);
            } catch (err) {
                console.warn('[Worldkit] weather thunder listener failed', err);
            }
        }
        this.scheduleThunder();
    }

    /* ---- loop ---- */

    shouldRun() {
        return this.enabled && this.layers.size > 0 && !document.hidden && !this.reducedMotion() && !!this.canvas?.isConnected;
    }

    sync() {
        if (this.shouldRun()) {
            if (this.raf === null) {
                this.lastTs = 0;
                this.raf = requestAnimationFrame(ts => this.tick(ts));
            }
            return;
        }
        if (this.raf !== null) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        // Reduced motion: one still frame of the calm layers, redrawn only when something changes.
        if (this.enabled && !document.hidden && this.reducedMotion()) this.drawFrame(0, performance.now());
    }

    tick(ts) {
        this.raf = null;
        if (!this.shouldRun()) {
            this.ctx?.clearRect(0, 0, this.width, this.height);
            return;
        }
        const frameMs = this.plan?.frameMs || 0;
        if (frameMs && this.lastDraw && ts - this.lastDraw < frameMs - 1) {
            this.raf = requestAnimationFrame(t => this.tick(t));
            return;
        }
        const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.1) : 0.016;
        this.lastTs = ts;
        this.lastDraw = ts;
        this.drawFrame(dt, ts);
        if (this.layers.size) this.raf = requestAnimationFrame(t => this.tick(t));
        else this.ctx.clearRect(0, 0, this.width, this.height);
    }

    drawFrame(dt, now) {
        const { ctx, width: w, height: h, env } = this;
        env.t += dt;
        env.now = now;
        const g = this.plan?.wind?.gust || 0;
        env.gust = 1 + g * (0.6 * Math.sin(env.t * 0.7) + 0.4 * Math.sin(env.t * 1.9 + 1));
        if (env.flash && now - env.flash.start > 1500) env.flash = null;
        ctx.clearRect(0, 0, w, h);
        for (const id of [...this.order]) {
            const layer = this.layers.get(id);
            if (!layer) continue;
            if (layer.alpha !== layer.target) {
                const step = dt === 0 ? Infinity : layer.rate * dt;
                layer.alpha = layer.alpha < layer.target
                    ? Math.min(layer.target, layer.alpha + step) : Math.max(layer.target, layer.alpha - step);
            }
            if (layer.removing && layer.alpha <= 0) {
                this.layers.delete(id);
                this.order = this.order.filter(x => x !== id);
                continue;
            }
            // Shrink a retuned layer a little each frame instead of cutting particles all at once.
            if (layer.pool.length > layer.targetCount) {
                const drop = Math.max(1, Math.ceil((layer.pool.length - layer.targetCount) * Math.min(1, dt * 2)));
                layer.pool.length = Math.max(layer.targetCount, layer.pool.length - drop);
            }
            const drawer = DRAWERS[layer.effect];
            env.alpha = layer.alpha;
            ctx.globalAlpha = layer.alpha;
            const pool = layer.pool;
            for (let i = 0; i < pool.length; i++) {
                if (dt > 0) drawer.step(pool[i], dt, w, h, layer.cfg, env);
                drawer.draw(ctx, pool[i], w, h, layer.cfg, env, i);
            }
            ctx.globalAlpha = 1;
        }
    }

    /* ---- public ---- */

    setWeather(desc) {
        this.desc = desc && typeof desc === 'object' ? { ...desc } : null;
        this.apply(DEFAULT_FADE_MS);
    }

    setEnabled(on) {
        on = !!on;
        if (on === this.enabled) return;
        this.enabled = on;
        if (on) {
            this.mount();
            this.listen(true);
            this.apply(DEFAULT_FADE_MS);
            return;
        }
        clearTimeout(this.thunderTimer);
        this.thunderTimer = null;
        this.listen(false);
        this.layers.clear();
        this.order = [];
        this.env.flash = null;
        this.sync();
    }

    setDensity(value) {
        const n = Number(value);
        this.density = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
        this.apply(800);
    }

    setLowPower(on) {
        this.lowPowerManual = !!on;
        if (this.canvas) this.resize(true);
        this.apply(800);
    }

    onThunder(cb) {
        if (typeof cb !== 'function') return () => {};
        this.thunderListeners.add(cb);
        return () => this.thunderListeners.delete(cb);
    }

    destroy() {
        this.setEnabled(false);
        clearTimeout(this.resizeTimer);
        this.thunderListeners.clear();
        if (this.battery) {
            this.battery.removeEventListener('levelchange', this.onBattery);
            this.battery.removeEventListener('chargingchange', this.onBattery);
            this.battery = null;
        }
        this.canvas?.remove();
        this.canvas = null;
        this.ctx = null;
        this.desc = null;
        this.plan = null;
    }
}

/**
 * A weather effects canvas. Nothing is added to the page until setEnabled(true).
 * @param {{ layer?: 'behind'|'front' }} [options] behind the chat (default) or in front of it, dimmed
 * @returns {{ setWeather(desc:object):void, setEnabled(on:boolean):void, setDensity(n:number):void,
 *   setLowPower(on:boolean):void, onThunder(cb:function):function, destroy():void }}
 */
export function createWeatherFx(options = {}) {
    const fx = new WorldkitWeatherFx(options);
    return {
        setWeather: desc => fx.setWeather(desc),
        setEnabled: on => fx.setEnabled(on),
        setDensity: n => fx.setDensity(n),
        setLowPower: on => fx.setLowPower(on),
        onThunder: cb => fx.onThunder(cb),
        destroy: () => fx.destroy(),
    };
}
