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

## Playing

- **Move:** drag on the left half of the screen. **Look:** drag on the right half. **Attack:** tap the right half or the sword button.
- **Sword skills:** Sonic Leap, Horizontal Square, Vorpal Strike. They cost SP and have cooldowns.
- **Dodge** has i-frames. **Guard** blocks frontal hits; guarding right as a hit lands parries it and staggers the attacker.
- **Switch** sends your partner in with a skill while you back off. **Lock** targets the nearest enemy in front of you.
- The **Teleport Gate** in the plaza takes you to any unlocked floor. Defeat the floor boss at the tower to unlock the next one.
- **Menu → AI Lab** shows what the monsters predict you'll do, what your partner has learned from you, the boss's Q-values and the Director's skill estimate.

Desktop keys: WASD move, J attack, 1/2/3 skills, Space dodge, K guard, Q switch, E potion, Tab lock, F interact, Esc menu.

## Building the APK

```
cd web && npm install && node tools/build.mjs      # writes web/dist
cd ../android && gradle assembleRelease            # needs the Android SDK (sdk.dir in local.properties)
```
The APK lands in `android/app/build/outputs/apk/release/`. GitHub Actions also builds it on every push to `main` (Actions tab → latest run → `SpireOnline-apk`).

## Using your own Kirito / Asuna

On the title screen, tap **Load your own .vrm** under a hero and pick a file on your phone (a VRoid Studio export, or a VRoid Hub download whose author allows use). It's stored on the device and used from then on. To change the built-in defaults, replace the files in `web/public/models/` and the URLs in `web/src/main.js`. The current heroes are free stand-ins.

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
- `three-vrm-girl.vrm`: pixiv Inc. (free use, modification and redistribution).
- `Scarecrow.vrm`, `EYESummoner.vrm`: Polygonal Mind (100Avatars), CC0.
