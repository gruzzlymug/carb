# Driving Game MVP Specification (v0.1)

## Project Goal

Create a simple browser-based driving game inspired by **Spy Hunter**, rendered using **procedurally generated 3D vector graphics** with an **isometric-style camera similar to Zaxxon**.

This is intentionally an MVP. The architecture should be clean enough to support expansion, but should avoid unnecessary abstraction or enterprise patterns.

---

# Technical Requirements

## Platform

- Runs entirely in a modern web browser
- Cross-platform
- No installation required
- 60 FPS target

## Technology

Preferred stack:

- TypeScript
- HTML5
- Canvas 2D rendering (preferred for MVP)

Do **not** use:

- Three.js
- Babylon.js
- Unity
- WebGL frameworks

The goal is to build a lightweight custom vector renderer.

---

# Graphics

## Style

The graphics are intentionally minimal.

Everything is composed from:

- colored lines
- filled polygons
- flat shading

No:

- textures
- lighting
- shadows
- sprite sheets
- imported models

Think:

- Atari arcade
- Battlezone
- Zaxxon
- Spy Hunter

---

# Camera

Camera is fixed.

It should resemble the perspective used by Zaxxon.

Characteristics:

- elevated
- angled downward
- orthographic/isometric appearance
- road moves toward the player
- player car remains near bottom-center of screen

The camera never rotates.

---

# World

The world is procedurally generated forever.

There are no levels.

Generation occurs ahead of the player.

Old geometry is discarded behind the player.

---

# Coordinate System

Use a standard 3D world.

```text
X = horizontal
Y = forward along road
Z = height
```

The renderer projects world coordinates into screen coordinates.

---

# Initial Models

Only create three model types.

## Road

Road is built procedurally from connected segments.

Each segment contains:

- left edge
- right edge
- center line

Initially:

- perfectly straight
- constant width

Later versions can add:

- curves
- elevation
- intersections

## Player Car

Simple low-poly model.

Suggested geometry:

- body
- roof
- windshield
- wheels as boxes

No detailed meshes.

Approximately 30–60 polygons maximum.

## Gas Station Assembly

One reusable object.

Contains:

- small rectangular building
- cashier stand
- 2–4 fuel pumps
- roadside sign

Entire assembly is one procedural object.

No imported assets.

---

# World Objects

Initially only support:

- road
- player
- gas station

Gas stations appear occasionally along the road.

---

# Rendering

Pipeline:

```text
World
↓
Camera transform
↓
Projection
↓
Depth sort
↓
Polygon rendering
```

Painter's Algorithm is sufficient.

No z-buffer required.

---

# Controls

```text
Q = forward + left
W = forward
E = forward + right

A = left
S = brake
D = right
```

No reverse gear in MVP.

---

# Vehicle Physics

Variables:

- speed
- heading
- position

Rules:

- constant acceleration
- constant braking
- maximum speed
- steering effectiveness increases with speed
- mild friction when throttle is released

---

# Game Loop

```text
Input
↓
Physics
↓
Procedural Generation
↓
Rendering
↓
Repeat
```

Use `requestAnimationFrame()` with delta time.

---

# Architecture

```text
src/
    main.ts
    engine/
    world/
    entities/
    graphics/
    math/
    util/
```

Use small composable classes and plain data objects.

---

# Mesh Representation

```ts
interface Mesh {
    vertices: Vec3[];
    faces: Face[];
}

interface Face {
    indices: number[];
    color: string;
}
```

No UVs or normals.

---

# Initial Gameplay

The player drives endlessly along a procedurally generated highway.

Gas stations appear occasionally.

No enemies, collisions, score, fuel, or weapons yet.

---

# Performance Goals

- 60 FPS
- 200–500 visible polygons
- Low memory usage
- Minimize allocations inside the main loop

---

# Future Expansion (Not Yet)

- Curved roads
- Traffic
- Enemy cars
- Fuel
- Weapons
- Bridges
- Terrain
- Sound
- HUD
- Weather
- Gamepad support

---

# Guiding Principles

1. Keep the implementation simple.
2. Favor procedural generation.
3. Build a custom vector renderer.
4. Separate rendering, simulation, and world generation.
5. Optimize for readability and iteration.
