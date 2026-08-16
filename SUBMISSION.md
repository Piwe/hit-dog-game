---
title: "Hot Dog: a corgi, two mountains, and the one rule that keeps a game fair"
published: false
tags: devchallenge, weekendchallenge, gamedev, javascript
---

*This is a submission for the [DEV Weekend Challenge: Dog Days Edition](https://dev.to/devteam/join-our-dev-weekend-challenge-dog-days-edition-1000-in-prizes-across-five-winners-submissions-1g4i).*

![Hot Dog title screen](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/menu.png)

## What I Built

**Hot Dog** is a browser game about a small corgi climbing between two mountains.

Ledges jut out of the facing cliff walls in pairs, one on the left and one on the right at every height. Every jump goes up exactly one level, and the arrow keys only choose *which side you land on*. That's the entire control scheme, and it's the entire game: look at the pair of ledges above you, work out which one is about to erupt, and jump to the other one.

Clouds hang below the ledges. Some are decorative. Others are steam vents running a four-stage cycle:

```
IDLE --> BUILDUP --> BURST --> COOLDOWN --> IDLE
        (telegraph)  (lethal)   (safe)      (safe)
```

**BUILDUP is your only warning.** The cloud glows and a flame grows out of it a beat before the real eruption.

Every ledge you reach earns a hot dog, and hot dogs make the dog more *agile*: jumps drop from 560 ms to 200 ms, and an agile dog can stand in a live burst for 260 ms and still hop clear where a sluggish one has 60 ms. Get caught and it runs the other way - you lose agility, drop two ledges, and become easier to hit next time.

That downward spiral is the design. It's also the thing that nearly broke the game, which I'll come back to.

Reach the top and the corgi gets a trophy and a red cape.

![Gameplay: the corgi mid-climb with two vents building steam](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/gameplay.png)

## Demo

### [**>> Play Hot Dog in your browser <<**](https://piwe.github.io/hot-dog-game/)

No install, no sign-up - it is a static page.

Controls: `Left` / `Right` to jump, `Enter` to start, `` ` `` for a debug overlay, `M` to mute. Add `?seed=12345` to replay an exact climb.

Or run it locally - no build step, no dependencies:

```bash
git clone https://github.com/Piwe/hot-dog-game
cd hot-dog-game
python3 -m http.server 8080     # then open http://localhost:8080
```

## Code

{% embed https://github.com/Piwe/hot-dog-game %}

Roughly 2,000 lines of vanilla JavaScript across 14 modules, 1,800 lines of Python asset tooling, and 17 tests. **Zero runtime dependencies** - no framework, no build step, no `node_modules`.

## How I Built It

### Vanilla JS and Canvas 2D, on purpose

One level, sprite-based, no real physics. Jumps are parabolic tweens between two known points and collision is a slot lookup. Phaser would have added a megabyte and a build config to supply a scene manager and a tween library that this game needed about a hundred lines of.

The architecture has one rule that turned out to be load-bearing: **`game/` is the simulation and never touches the canvas; `render/` reads world state and never mutates it.** There's a test asserting the whole simulation runs with `document` undefined. That's what let me test the game logic headlessly without a browser, and it's why the speed slider is trustworthy - it can't accidentally couple to frame rate.

### The one rule that keeps the game fair

This is the constraint everything else bent around:

```
buildupMs / speedScale  >  jumpMsFor(agility)
```

The vent's warning must always last longer than the dog's slowest possible jump. If it doesn't, the dog is committed to a jump *before* the warning appears, and the game stops being hard and starts being broken.

My first set of numbers **failed this**. At maximum speed with zero agility, the telegraph was 500 ms against a 620 ms jump. And zero agility is exactly the state a struggling player is in - so the difficulty spiral would have quietly made the game unwinnable at the moment it was already punishing you.

The fix was raising buildup to 1200 ms and capping the speed slider at 1.5x. The test suite now sweeps the entire speed x agility cross-product to enforce it, and the debug overlay shows the live margin while you play:

```js
test('telegraph always outlasts the slowest jump, at every speed and agility', () => {
  for (let speed = CFG.speed.min; speed <= CFG.speed.max; speed += 0.05)
    for (let ag = 0; ag <= 1; ag += 0.05)
      assert.ok(CFG.vent.buildupMs / speed > jumpMsFor(ag));
});
```

The speed slider is the only difficulty control, and it scales **vent cadence
only** - it never touches jump speed or input handling, so the controls feel
identical at every setting. Here it is pushed to FAST, with three vents
erupting at once:

![The speed slider at maximum, three vents erupting](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/speed-slider.png)

The other fairness rule: a rung **never** gets vents on both sides. There's always a survivable line, verified across 400 generated levels.

### The art fought back

The sprite sheets were composite illustrations, not game-ready atlases, so `assets/` is fully generated by a Python pipeline: cut -> derive -> pack, deterministic enough that two clean builds are byte-identical.

Three things the source art couldn't give me:

**The vent telegraph was unreadable.** The shipped "building steam" cloud differed from the idle cloud by a few small bubbles - invisible at gameplay size, and that frame is the player's *entire warning*. I rebuilt it as a 6-frame ramp by compositing a scaled, dimmed copy of the real eruption onto the cloud, so the warning grows in **size and brightness** and reads on shape alone (which also means it survives colour-blindness).

![The rebuilt 6-frame vent ramp](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/vent-ramp.png)

**One parallax layer was unkeyable.** The distant-peaks strip had its sky baked in, and its snow and clouds sat at the *same pale value* as that sky. Every threshold either kept a rectangular slab of sky - visible in-game as a hard-edged block floating in the valley - or ate the mountain tops. I stopped fighting it: only the mid strip keys cleanly, so the far and foreground layers are now restyled copies of that one good silhouette, desaturated and pushed toward the horizon colour for distance, darkened and blurred for foreground. That's what atmospheric perspective *is*, which is why it reads correctly.

![Four parallax depths derived from one clean silhouette](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/parallax-layers.png)

**The mountain wall didn't exist.** The two-mountain painting is a picture, not a tileable texture - cropping it gave smeared boulders the size of the dog. So the wall is drawn procedurally from a palette sampled out of that same painting, every shape drawn at +/- one tile height so it's seamless by construction rather than by blending.

### Anchors are the contract

Every sprite carries a normalised anchor: the dog's between its paws, a vent's at its base. Everything draws at `(x - w*anchor.x, y - h*anchor.y)`.

That sounds like bookkeeping until it isn't. The jump animation squashes and stretches the dog around that anchor, which is the only reason its paws stay planted on the ledge while its body deforms - a transform around the sprite's centre slides the feet into the air.

## Prize Categories

I went after **Best use of ElevenLabs** and **Best use of Google AI**, and both are wired the same way, because of one decision:

> **All AI generation happens at build time. The output is committed. The browser never sees an API key.**

The game is a static page and the repo is public. Calling either API from the client would ship a credential to anyone who opened devtools. So every integration is a Python tool in `tools/` that writes into `assets/`, exactly like the rest of the asset pipeline.

The second decision follows from the first: **every integration degrades gracefully.** The game ships fully playable with no keys at all. Generation is a pure upgrade.

### ElevenLabs - sound, and the second telegraph channel

`tools/audio_gen.py` generates eight sound cues plus a looping ambience bed via the sound-effects API (the v2 model has a `loop` flag, which beats the music endpoint for a seamless bed) and a music track via the music API.

The cue I care most about is **`hiss`**. It's the *audio half of the vent telegraph* - the warning for players who miss the visual one - so its prompt asks specifically for a clearly rising pitch. Accessibility as a sound-design brief.

`core/audio.js` tries a sample first and falls back to a synthesised WebAudio version per cue, so a partial generation is always safe to ship.

The tricky bit was timing: an `AudioContext` can't exist before the first user gesture, so samples are *fetched* at load and *decoded* when the context appears. Testing that path caught a real bug - the retry that starts the music loop after decoding was keyed to the music track only, so a build with an ambience bed but no music would have been permanently silent.

### Google AI - a commentator that knows when to shut up

This one uses both sponsors together. **Gemini writes the lines, ElevenLabs speaks them**, both at build time.

Gemini generates a bank of reactive one-liners across eight moments - near miss, blasted, clean streak, halfway, struggling, summit - using `responseSchema` for structured JSON so it comes back as clean per-category arrays instead of prose I'd have to parse. The text lands in a committed, hand-editable file, so you can curate what the commentator says without regenerating.

**The hard part was never the text. It was restraint.** A commentator that reacts to every jump is unbearable within thirty seconds. So the runtime enforces:

- a **priority order** (`summit` > `hit` > `escape` > `struggle` > milestones > `streak`), so only the most interesting thing on a tick gets said;
- a **per-priority cooldown**, so quiet moments stay quiet;
- a **shuffle bag** per category, so no line repeats until its category is exhausted.

Derived moments - a six-ledge clean streak, struggling after repeated hits - are computed in the commentator, not the simulation. They're commentary, not game rules.

Unvoiced lines display as captions, which doubles as subtitles.

![The commentator reacting to a steam blast](https://raw.githubusercontent.com/Piwe/hot-dog-game/master/docs/screenshots/commentator.png)

Gemini also drives the art gap-fill (`tools/art_gen.py`): a drawn jump cycle and a purpose-built foreground layer. Two problems the model can't solve on its own, handled in the tool:

- **Transparency.** Image models return opaque images, so everything generates on a flat magenta field and gets chroma-keyed, with a despill pass to kill the purple fringe. Magenta is safe because nothing in this art style is magenta.
- **Consistency.** A jump cycle has to be the *same* dog, matching art that already shipped - so every request carries an existing sprite as a reference image rather than trusting the prompt.

And anchors for generated frames are **measured from the pixels** (the centroid of whatever touches the ground), never assumed. A guessed anchor would misplace the dog on every single ledge.

## What I'd do next

The remaining work is difficulty tuning, and it's the one phase none of this tooling can do. Everything up to here was verifiable by assertion or screenshot. Whether the game is *fun* is not.

The most promising lead: vent density is a flat 35% for the whole climb, so the difficulty has texture but no curve. Ramping it with height is a two-line change and probably the single biggest improvement left.

Thanks for reading - and to the corgi, who took a great many steam blasts in testing.
