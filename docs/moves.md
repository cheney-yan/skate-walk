# Longboard dance move library (decomposed from reference clips)

Source clips (frame-sheet analysis at 3–4 fps; numbers are eyeballed from video, good enough for keyframing):
- **A** Terri O, Tel Aviv night — https://www.youtube.com/shorts/ZJUEY0lMsTs (12 s)
- **B** Kate Voynova, Sochi — https://www.youtube.com/shorts/BE2SfHBGfkI (10 s)
- **C** Douyin girl, seaside promenade, pale-blue long shirt + white mini skirt — https://www.youtube.com/shorts/tbVYcMg6D38 (13 s)
- Earlier: Loaded "Longboard Ollie" tutorial (MTdeEgqiUVw), Vogue Ko Hyojoo carving (ynakjV77kZk), Valeriya / Peninsula Paris (FJCB0OBj7FQ), Longboard Girls Crew (OVVadHR3h3c).

Deck coords used in `js/rider.js`: z along the board (+ = nose, bolts at ±0.31 m, tips ±0.49), x across.
Status: ✅ in game · 🟡 partial · ⬜ not yet.

## What makes it look light (all three clips agree)
1. Head up, eyes down the road, never at the feet. Head **leads** every rotation (spotting).
2. Hips stay at constant height while walking the board; knees ~10–15° at held poses, 25–30° only in transitions.
3. Feet place toe-first, quietly — no stomp, so the torso doesn't jolt.
4. The arm on the stepping side reaches a beat **before** the foot moves (arm "pulls" the body).
5. Arms open at chest–shoulder height like a tightrope pole; hands open, fingers soft, never fists.
6. Carves are small (5–15°), the board drifts; speed is maintained, never chased. No dead frames between moves.

## Moves

| Move | Clips | Duration | Feet (deck z) | Knees | Arms | Board | Status |
|---|---|---|---|---|---|---|---|
| **Cross-step forward** (walk to nose) | A 0.5–2.0 s, B 0–0.3, C 1.0–1.7 | 0.5–0.6 s per step, 2–3 steps | back foot crosses OVER front, lands ahead; then front foot steps forward along the rail; ends both feet in the front third (nose +0.42, other +0.31) | 15–25°, support leg a bit deeper on plant | stepping-side arm forward-left at waist→chest, other trails back at hip; wingspan widens each step | gentle S-drift, <15° yaw | ✅ (dance seq) |
| **Nose walk hold / hang** | A 2.0, A 7.5, A 11.3 | 0.5–1 s | both feet near nose | ~10° (tall) | widest, shoulder height, elbows soft | nose dips slightly | ✅ |
| **Peter Pan** (one foot, other leg floats) | A 3.0–3.5, B 3.0–3.3, C 0–1.0 (high-knee kick entry) | 1–1.5 s glide | support foot centred/front; free leg extends behind & up (or knee lifts to ~90° then steps to nose) | support 20–30° | full T, shoulder height, elbows nearly straight, palms down | straight pure glide | ✅ (behind-leg version) |
| **Cross-step back** (nose → tail) | A 3.5–4.0, A 7.75–8.0 | 0.5 s per step | reverse pattern: rear foot crosses behind | ~20–25° | opposite arm reaches; calm torso | 10–15° drift | ✅ |
| **Ghost pivot / 180 body rotation** | A 2.5–3.0, A 8.25–9.0, A 10.25–10.5, B 2.0–2.3 | 0.5–0.75 s | feet together mid-deck, ball/heel pivot; may hop | load 30° then 25° | sweep: wide → in to chest → out again ("figure skater gather") | board keeps rolling, rider turns over it; ends switch | ⬜ |
| **Pirouette / 360 standing spin** | C 1.7–2.3, C 8.7–10.0, B 8.0–8.6 | 0.7–1.3 s | feet close at centre, ball of front foot + heel of back foot | load 30–40°, rise mid-spin | open (torque) → pull in to chest (accelerate) → re-open; hair flies out | slight yaw; slows a little | ⬜ (next) |
| **Kick-back free leg** | C 7.7–8.4 | 0.7 s | front foot planted, back foot lifts, knee ~90°, heel to glutes | standing 15–20° | both out, one higher | straight on one foot | ⬜ (next) |
| **Ghostride** (step off, board rolls free, step back on) | B 0.7–1.7, C 3.7–4.3 | ~1 s | front foot steps to ground, run beside, front foot back on nose then back foot | ground leg 35–40° | wide wings, open hands | board decelerates slightly, straight | ⬜ |
| **Shuffle / re-centre** | A 4.0–4.5, B 3.7–4.0 | 0.5 s | small slides without lifting | 30–35° dip | lower to mid-height | — | 🟡 |
| **Wide surf stance** | B 7.6 | held | nose-ish & tail, toes out ~30°, ~65 cm apart | 40–45° (deep) | T at shoulder | slight carve | ⬜ |
| **Push** | A 4.5 | 0.9–1.1 s cycle | back foot to ground beside front truck, planted (world-stationary), recover to tail | support ~20° | lower-forward | accelerates | ✅ |
| **Shove-it** (board spins 360° under her) | own | ~0.9 s | both feet lift ~8 cm | crouch/extend as ollie | wide | 360° yaw in air | ✅ |
| **Kick-up pickup** | Loaded / common technique | ~1.3 s | back foot stomps tail, board pivots on rear wheels to ~80°, nose into the hand | — | right hand waits at hip height | pivots, no free flight | ✅ |
| **Slide stop / heel drag / roll-out** | common | 0.5–6 s | slide: deck swings ~75° across; heel: back heel drags behind tail | 45–70% crouch | out for balance | decel 2.6 / 1.4 / 0.45 m/s² | ✅ |
| **Run-up remount** | common | ~1.5 s | shove the board ahead, 3 quick jog steps (~2.4 m/s), hop on | — | swing with steps | board rolls ahead of her | ✅ |

## Outfit reference (clip C)
Light sky-blue oversized long shirt (mid-thigh, white collar/cuffs) worn loose over a short white pleated skirt,
white mid-calf socks, chunky white platform sneakers, very long straight black hair worn loose.
The shirt tail flares in spins; the skirt peeks out below it. → implemented as `?outfit=shirt` (default).

## Physics notes (this game, deliberately slicker than reality)
- Rolling resistance Crr 0.0045 (real urethane on smooth concrete ≈ 0.008–0.012), CdA 0.30 m².
- Stamina (耐力) = metabolic J, 15 kJ bar; muscle efficiency 25%; aerobic refill ~230 W; downhill coasting refills fastest.
- Speed bar (速度) = kinetic energy ½mv² relative to the top speed: the bank you can spend on the next climb before your legs pay.
