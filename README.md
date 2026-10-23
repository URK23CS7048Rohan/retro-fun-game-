# Spire Online

A fan-made, SAO-inspired action RPG for Android: climb a 100-floor tower, one procedurally generated floor at a time. Anime characters (VRM), HD sunset world, and a lot of ML and classic game algorithms running the monsters, your companion and the difficulty.

> Non-commercial fan project. *Sword Art Online* names and characters belong to their owners. Don't publish this to an app store with them.

## What's in here

| Path | What it is |
|---|---|
| `web/src/engine` | Renderer (ACES, soft shadows, bloom, god rays, grading, optional retro filter), painted sky shader, PBR texture loader |
| `web/src/world` | Floor generator: terrain splatting, town, guild hall, labyrinth tower, forests, GPU wind grass, props, atmosphere |
| `web/src/chars` | VRM character driver (pose-space animation mapped to humanoid bones, spring-bone hair, blinking), weapons |
| `web/src/ai` | Markov predictor, Q-learning boss, MLP behaviour cloning, A* navigation, AI director (Kalman skill estimate), boids |
| `web/src/game` | Input (touch + keyboard), follow camera, effects |
| `web/public` | Textures, prop models, VRM models |

## Using your own Kirito / Asuna

Drop `.vrm` files into `web/public/models/` (VRoid Studio export or a VRoid Hub download whose author allows use). The current models are free stand-ins.

## Running the preview

```
cd web && npm install
npx esbuild preview/hd.js --bundle --outfile=preview/hd.bundle.js --format=iife
cp -r public/tex public/models public/props preview/
npx http-server . -p 8123   # open http://localhost:8123/preview/hd.html?shot=vista
```

## Asset credits

- Textures and props: [Poly Haven](https://polyhaven.com), CC0.
- `AvatarSample_B.vrm`: VRoid Project / pixiv Inc. ([terms](https://vroid.pixiv.help/hc/ja/articles/4402394424089-AvatarSample-A-B-C)).
- `Seed-san.vrm`: VirtualCast, Inc., VRM Public License 1.0 (credit required).
