<h1 align="center">King of Fighters</h1>

<img src="readme_assets/1.png" width="100%">

<h2 align="center"><a  href="https://youtu.be/HRxvA9wOfb8">View a Demo</a></h2>

## Description


<p align="center">
<img src="readme_assets/1.gif" width="80%"></p>

A horizontal fighting game built with the **Phaser 3** game engine and JavaScript ES6. Two players share a keyboard to fight against each other. The character (Kyo Kusanagi) has four actions and seven states.

> Originally built with CSS, jQuery and the Canvas API; now refactored onto Phaser 3 (Scenes, the Phaser game loop, keyboard input and the texture manager) bundled with Vite.

**The King of Fighters inspires this project** .

## How to play

- **Share** a keyboard.
  | Character Movements | Player 1 |  Player 2  |
  | :-----------------: | :------: | :--------: |
  |        Jump         |    w     |  ArrowUp   |
  |      Go Right       |    d     | ArrowRight |
  |       Go Left       |    a     | ArrowLeft  |
  |    Throw a Punch    |  Space   |   Enter    |
- **Beat** your opponent before the countdown ends.

## About the project

### Phaser 3 architecture

- `PreloadScene` decodes every character/background GIF and registers each frame
  with Phaser's texture manager, then hands off to `FightScene`.
- `FightScene` runs the Phaser game loop, draws the HP-bar / countdown HUD and
  drives the two players.
- `Player` / `Kyo` hold the gameplay logic (movement, state machine, collision)
  and render through a Phaser sprite whose texture is swapped each frame.

### GIF assets

- The original art ships as animated GIFs. A small bundled decoder
  (`src/utils/gif.js`) composites each GIF frame onto a `<canvas>`, which is
  registered as a Phaser texture (`registerGifTextures`) so the existing artwork
  is reused as-is — no asset conversion required.

  <p align="center"><img  src="readme_assets/2.gif" width="80%"></p>

### Finite-state Machine

- A finite-state machine with a state collection, state transitions and a current
  state variable. Together with character variables (initial position, direction,
  speed, gravity, etc.) it gives the character seven smooth animations.
- 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death

### Collision Detection

- Axis-Aligned Bounding Box collision detection drives attack, hit and death.

<p align="center"><img  src="readme_assets/2.png" width="70%"></p>


## Project setup

```bash
npm install      # install Phaser 3 + Vite
npm run dev      # start the dev server (opens the game in your browser)
npm run build    # produce a production build in dist/
npm run preview  # preview the production build
```

## Future scope

- Add other characters.
- Add character skills.