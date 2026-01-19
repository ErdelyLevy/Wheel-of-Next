# 🎡 Wheel of Next

**Wheel of Next** is a web-based decision wheel inspired by the mechanics of *Game Gauntlets*, but powered by real user data from **Ryot**.

The project helps users fairly and visually decide what to watch, play, or choose next using their own media collections.

---

## ✨ Project Idea

Many media tracking services face a common problem:

> “I have a lot of content — what should I pick next?”

**Wheel of Next** solves this by combining:
- a visual spinning wheel,
- weighted randomness,
- presets and collections,
- and real user-owned data.

---

## 🔗 Data Source

This project integrates with **Ryot**, an open-source media tracking platform:

https://github.com/IgnisDa/ryot

Used data includes:
- collection items (movies, series, games, etc.),
- posters and metadata,
- user-defined lists / presets.

---

## ⚙️ Features

- 🎯 **Interactive decision wheel**  
  Smooth, animated canvas-based wheel.

- ⚖️ **Weighted random selection**  
  Each item can influence its probability via configurable weights.

- 🗂 **Presets**  
  Switch between different item sets (e.g. *Movies for Tonight*, *Games to Finish*).

- 🕒 **Spin history**  
  Store and display previous results.

- 🖼 **Poster handling with fallbacks**  
  Robust image loading with intelligent fallback logic.

- 🧩 **Modular frontend architecture**  
  Design principle: *one file — one logical responsibility / entry function*.

---

## 🧱 Architecture Overview

### Frontend
- Vanilla JavaScript (no frameworks)
- Canvas-based rendering
- Feature- and view-oriented structure

### Backend
- Node.js
- API layer for presets, spins, and history
- Integration with Ryot data sources

---

## 🎮 Comparison with Game Gauntlets

| Game Gauntlets | Wheel of Next |
|----------------|---------------|
| Static item sets | Real user collections |
| Limited customization | Configurable weights & presets |
| Game-focused | Decision-making focused |

---

## 🚧 Project Status

The project is under active development.

Core architecture is in place; UI/UX and features are continuously evolving.

---

## 🧠 Who This Project Is For

- Movie, series, and game enthusiasts
- Ryot users
- Anyone struggling with choice paralysis
- Developers interested in:
  - canvas animations,
  - framework-free frontend architecture,
  - clean, modular JavaScript

---

## 📄 License

MIT
