# Hair & cloth wind rig (girl.js `setupHair().update`, `Skirt.applyAero`)

All forces use the relative air `air = V_wind − V_char` (spec's V_rel = −air), split in her frame by travel direction:
`along = dot(downwind, fwd)` (−1 headwind … +1 tailwind), `cross = |dot(downwind, side)|`.

## Velocity tiers (smoothly blended by |air| in km/h)
| tier | km/h | hair pitch (from hanging) | damping (dragForce) | extras |
|---|---|---|---|---|
| T0 idle | 0–5 | 0° | 0.75 | breathing sway 0.5 Hz ±2° |
| T1 cruise | 5–25 | 0→35° | 0.6 | soft wave travelling to the tips; carve lag τ≈0.37 s |
| T2 high | 25–60+ | 35→78° | 0.25 | tip turbulence 8–15 Hz (∝ tip²); stiffness ×0.7; carve lag τ≈0.22 s |

- Direction matrix: target = rotate "down" toward downwind by the tier pitch → headwind trails back, crosswind leans downwind
  (side-cohesion pull relaxed by `cross`), tailwind lifts the tail forward (pitch ×1.4, capped 70° to keep it off the face).
- Bangs (chains in front of the head): headwind presses them back, tailwind flips them forward.
- Closed loop: each chain's root→tip direction is measured every frame and its gain (0.6–4.5) is integrated until it
  reaches the target — the spring bones' rest pose otherwise eats the wind.
- Carving / bumps: lateral accel v²κ (+ pumping) and vertical accel feed a first-order lag → tail swings to the outside a
  beat late (S-whip because roots are stiffer than tips).

## Cloth
- Shirt tails = Verlet cloth with per-triangle aerodynamics (NvCloth `applyWind`):
  drag `Cd·|cosθ|·u|u|`, lift `Cl·cosθ·sinθ·|u|²` ⟂ u; ρ/σ = 1.2 / 0.17 kg/m² (light cotton), weak bending (0.15),
  side-bulge clamp so tails trail back instead of winging out; travelling gust fronts.
- Coat spring bones: drag ∝ v², same carve lag.
- Not modelled (she wears no jeans): thick-denim tier, windward "tight collider skinning", leeward billow inflation.
