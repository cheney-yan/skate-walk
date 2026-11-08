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
| **Throwdown** (running mount — THE remount) | Cheney's picks: Alina Ruess tQNzYSUsJdk 73.4–74.8 (side), 日落江边 1MQl0CZNdls 0.07–1.5 (back) → `data/moves/throwdown.json` (`game` = `rider.TD`) | run 0.9 s + set 0.25 + beside 0.45 + step 0.5 + absorb 0.45 | right hand on the nose, REAR WHEELS ROLL on the path (deck ~55°, axle on a line 0.32 m right of her); she presses the nose down (pivot = rolling rear axle; the deck follows her hand), lets go, it falls flat and rolls on a touch slower (2.1 m/s); one step beside it, front foot onto the front bolts, back foot swings onto the tail (HOP-ON foot paths); she rides from the board's line and carves back to the path line | light absorb only (knees ~145–170° in game) | lean ~25° while running; arms open on the step-on | measured: rear wheels 0.00 cm off the ground during run/set, no leg in the deck slab, planted-foot slip ≤1 mm/frame | ✅ (replaces drop/jog/hop-on) |

## Outfit reference (clip C)
Light sky-blue oversized long shirt (mid-thigh, white collar/cuffs) worn loose over a short white pleated skirt,
white mid-calf socks, chunky white platform sneakers, very long straight black hair worn loose.
The shirt tail flares in spins; the skirt peeks out below it. → implemented as `?outfit=shirt` (default).

## Physics notes (this game, deliberately slicker than reality)
- Rolling resistance Crr 0.0045 (real urethane on smooth concrete ≈ 0.008–0.012), CdA 0.30 m².
- Stamina (耐力) = metabolic J, 15 kJ bar; muscle efficiency 25%; aerobic refill ~230 W; downhill coasting refills fastest.
- Speed bar (速度) = kinetic energy ½mv² relative to the top speed: the bank you can spend on the next climb before your legs pay.

## Reference-derived parameters (data/moves/*.json → rider.js) — for the parent to wire

Pipeline: handoff package → `python3 tools/import_moves.py <pkg>` (refs/moves, IMPORT_REPORT.md) → `python3 tools/derive_moves.py`
(data/moves/{cross_step,arm_styling,pirouette,push}.json; each number = `{v, basis}`, `ref.*` = measured, `game.*` = proposed rider value,
`style_override` = where Cheney's style rules cap the reference) → rider.js (not wired yet). Inspect any sample with
`lab.html?ref=<move>` (best) or `lab.html?ref=<move>/<sample>` (stick figure + mp4 left, game right; `&refyaw=90` turns the figure,
`&refspeed=0.5`, `&refvid=0` no mp4). Coordinates: only `js/refskel.js` converts (y and z negated = 180° about x, no mirror).
Load pattern = the throwdown one in lab.js (`fetch('./data/moves/X.json')` → copy `game[k].v` into a `rider.X` params object).

| move | best sample | key numbers (game) | maps to in rider.js | what to implement |
|---|---|---|---|---|
| **push** | `pro_ARCk35WWnbk_20` (5分, side, regular, R foot pushes; 2 strokes) | T 1.07 s, contact 0.30 s starting 0.40 s after the push foot's highest point, support knee 135° (ref 122°, capped), glide knee 166°, lean 18° (ref 29°, capped), plant 0.11 m ahead of the hip → toe-off 0.58 m behind, recovery lift 0.08 m (ref 0.30 m, capped) | `startPush` (T now 1.3/1.0), `pushAccel` (c0 = 0.3·T, contact clamp(0.6/v,0.22,0.45)), push-pose block around `reach` (~line 784), foot path of the push foot | Replace the flat-ground T with `push.game.T` (keep the uphill shortening as a factor); set c0/contact from `c0`/`contactS` at low speed and keep the v-dependent shortening at speed (contact length really is ~reach/v); drive support-knee flexion and spine lean from the cycle phase with peaks at mid-contact (ref peaks: knee t0.60, torso t0.57, contact 0.47–0.77); plant point = `reachFwd` ahead of the hip, toe-off `reachBack` behind. The reference swings the recovery foot 30 cm high with knee ~100°; our rule says low (~5 cm) — Cheney decides (`recoveryLift`). |
| **cross_step** | `pro_ARCk35WWnbk_38` (5分, 45°, 2.9 s ≈ 4 crossings walking up to the nose) | step period 0.47 s, support knee 165°, stepping leg lift 152°, torso lean 16°, lead arm abd 61° / trail 23°, elbows 36°, feet stay ≤0.2 m apart | `DANCE_K` keyframes (steps at 0.5–0.6 s spacing today), dance arm block (`dn > 0`, ~line 877) | Retime DANCE_K's cross-step keys to `stepT` per step (today 0.5–0.6 s: close); stance knee `kneeSupport`, swing knee bends to `kneeStepLift` mid-step; add the small forward lean `torsoLean` during the walk (reference leans ~16°, Cheney wants long spine — try 8–10° first); arms: stepping-side arm leads to `armLeadAbd`, other `armTrailAbd`, elbows soft. Front foot unknown for this sample (view.stance goofy not confirmed by the skeleton) — mirror to her regular stance. |
| **pirouette** | `pro_ARCk35WWnbk_36` (5分, 45°, one 360° body turn, board keeps heading) | wind-up 0.55 s (lean 15°, ref 22°), spin 1.15 s, arms open 38° abd → gathered (wrist span 0.3 m) right at turn start → re-open 0.9 m from half-turn; knees 147° during, rise to 163°; torso 8°; feet 0.2 m apart | new move (nothing in rider.js yet; `ollie.kind==='shove'` spins the BOARD, not her) | Add `startPirouette()` like `startDance`: phase wind-up → spin → exit. Rotate her whole body (hips root yaw) by 360° over `spinT` with an ease that is faster while arms are gathered (angular momentum: pull-in at turn start, re-open after ~half turn); board yaw untouched; feet pivot on the balls (FOOT state TOE for the leading foot during the spin); knees `knee`, briefly `kneeRise` mid-spin; head spots (leads the hips). The exit heel-kick in the clip (knee 88°) is a flourish, not required. Feed nothing into the CoM lean chain except a small lean loss (`speedLoss` is a placeholder: board speed is not in the data). |
| **arm_styling** | `pro_ARCk35WWnbk_10` (4分, only 0.3 s, front camera) + timing from `pro_EiPZ7dODY0E_1` | outside arm up to 90° abd (ref 131° = overhead, capped), elbow 33°, other arm ≤35°, rise 0.33 s / hold 0.37 s / lower 0.33 s, knees 153° | the dance arm raise (`arc`, `eL/eR` smoothstep, ~line 883), `armUp` rise/settle rates | Replace the arc-driven raise with an explicit rise/hold/lower envelope from `riseS/holdS/lowerS` (ref is quick: 1 s total — today's arc is 4.2 s; for Cheney's elegant style scale ×2–3, keep the shape); cap at `upAbd` (shoulder height), elbow ≥ `upElbow`, inside arm ≤ `otherAbd`; body otherwise unchanged. Usable as a player-triggered flourish while gliding. |

Retargeting notes: ref knees are flexion (0 = straight) → rider interior = 180 − ref. Arm abduction is in the body's frontal plane (0 = arm down,
90 = horizontal). All four best samples are fullbody_ok, ok_ratio ≥ 0.99; world-coordinate jitter is 10–13 cm/frame² (moving camera), so
only angle medians/peaks are used, never raw world positions frame by frame (push reach distances are the exception — treat as ±0.1 m).

## 参考样本 (refs/moves)

<!-- REFS:BEGIN (generated by tools/import_moves.py — do not edit by hand) -->
包 `moves-2026-11-08`（schema 1.0, contract 1.0），106 样本 / 18 动作。「可抄角度」= fullbody_ok 且 ok_ratio ≥ 0.85 且腿骨长度波动 ≤ 12%（见 refs/moves/IMPORT_REPORT.md）。

| move | n | 5/4/3 | 可抄角度 | 机位 斜/侧/正 | best（最高分） | best 时长 | 回放 |
|---|---|---|---|---|---|---|---|
| `cross_step` | 23 | 1/10/12 | 18 | 18/5/0 | `pro_ARCk35WWnbk_38` (5分) | 2.9 s | `lab.html?ref=cross_step` |
| `arm_styling` | 22 | 0/11/11 | 22 | 10/11/1 | `pro_ARCk35WWnbk_10` (4分) | 0.3 s | `lab.html?ref=arm_styling` |
| `pirouette` | 19 | 1/13/5 | 19 | 12/5/1 | `pro_ARCk35WWnbk_36` (5分) | 2.0 s | `lab.html?ref=pirouette` |
| `push` | 10 | 1/5/4 | 9 | 5/5/0 | `pro_ARCk35WWnbk_20` (5分) | 1.8 s | `lab.html?ref=push` |
| `manual` | 7 | 2/3/2 | 5 | 1/5/1 | `short_tbVYcMg6D38_1` (5分) | 2.7 s | `lab.html?ref=manual` |
| `tiger_claw` | 5 | 3/1/1 | 3 | 3/2/0 | `pro_tQNzYSUsJdk_1` (5分) | 1.51 s | `lab.html?ref=tiger_claw` |
| `cruise` | 3 | 1/0/2 | 2 | 0/3/0 | `pro_tQNzYSUsJdk_10` (5分) | 3.5 s | `lab.html?ref=cruise` |
| `hop` | 2 | 0/0/2 | 2 | 1/1/0 | `D80MTOxjYqA_2` (3分) | 0.9 s | `lab.html?ref=hop` |
| `throwdown` | 2 | 1/1/0 | 1 | 1/1/0 | `pro_tQNzYSUsJdk_11` (5分) | 3.71 s | `lab.html?ref=throwdown` |
| `pump` | 2 | 0/0/2 | 2 | 2/0/0 | `pro_C91vOecuTZM_4` (3分) | 0.56 s | `lab.html?ref=pump` |
| `shove_it` | 2 | 0/1/1 | 2 | 0/2/0 | `uVBj5DUkgkM_2` (4分) | 2.9 s | `lab.html?ref=shove_it` |
| `ghostride` | 2 | 1/1/0 | 1 | 2/0/0 | `short_BE2SfHBGfkI_4` (5分) | 2.9 s | `lab.html?ref=ghostride` |
| `fall` | 2 | 1/0/1 | 1 | 0/2/0 | `uVBj5DUkgkM_1` (5分) | 3.4 s | `lab.html?ref=fall` |
| `no_comply` | 1 | 0/1/0 | 0 | 1/0/0 | `D80MTOxjYqA_4` (4分) | 2.5 s | `lab.html?ref=no_comply` |
| `low_crouch` | 1 | 0/1/0 | 1 | 1/0/0 | `pro_ARCk35WWnbk_13` (4分) | 2.0 s | `lab.html?ref=low_crouch` |
| `peter_pan` | 1 | 0/0/1 | 1 | 1/0/0 | `pro_ARCk35WWnbk_25` (3分) | 1.1 s | `lab.html?ref=peter_pan` |
| `footwork` | 1 | 0/0/1 | 1 | 0/1/0 | `pro_EiPZ7dODY0E_10` (3分) | 0.5 s | `lab.html?ref=footwork` |
| `ghostride_kickflip` | 1 | 0/1/0 | 1 | 1/0/0 | `tricks_peterpan_1` (4分) | 2.4 s | `lab.html?ref=ghostride_kickflip` |
<!-- REFS:END -->
