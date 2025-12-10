# AGENTS.md

## Overview
This project uses a multi-agent Codex workflow. Each agent owns a vertical slice of the technical domain and executes tasks autonomously. All agents operate on a shared codebase and follow the project's architectural constraints: Python 3.10, GLFW, PyOpenGL, modular shader-driven renderer, and SDF-based planet generation.

## Agents

### 1. RENDER_AGENT
Responsible for GPU pipeline correctness, shader structure, GLSL integration, and rendering performance.

**Primary Responsibilities**
- Maintain `planet.frag` and `planet.vert`
- Ensure SDF, terrain, atmosphere, and cloud features compile and run efficiently
- Add rendering features requested by tasks (lighting, colors, scattering)

**Capabilities**
- Edit GLSL and Python interop code
- Add uniforms, buffers, and pipeline logic
- Refactor shader code safely

---

### 2. TERRAIN_AGENT
Owns planetary surface modeling, height functions, biome logic, and terrain appearance.

**Primary Responsibilities**
- Implement FBM, domain warping, ridged noise, and biome masks
- Maintain height-based color gradients and material blending
- Improve terrain realism without harming performance

**Capabilities**
- Modify GLSL noise functions
- Add elevation masks and biome calculations
- Adjust planet SDF composition

---

### 3. ATMOSPHERE_AGENT
Handles atmosphere scattering, sky color, horizon glow, and volumetric cloud improvements.

**Primary Responsibilities**
- Add single- and multi-scatter approximations
- Improve horizon glow and limb effects
- Enhance cloud density and light response

**Capabilities**
- Edit raymarch loops
- Add optical depth approximations
- Insert scattering math as required

---

### 4. PIPELINE_AGENT
Responsible for Python-side system integration and architectural cleanliness.

**Primary Responsibilities**
- Maintain module structure (`main.py`, `rendering/`, `gl_utils/`)
- Add or update uniform plumbing and camera/viewport logic
- Ensure clean, minimal interfaces between Python and GLSL

**Capabilities**
- Add Python utilities
- Extend camera and input control
- Ensure correct OpenGL setup and teardown

---

### 5. PERF_AGENT
Focuses on optimization without altering features.

**Primary Responsibilities**
- Improve raymarch step heuristics
- Reduce shader divergence
- Optimize noise evaluation and sampling

**Capabilities**
- Insert early-outs, bounds checks, step-size strategies
- Profile GPU cost and propose micro-optimizations

---

## Workflow Rules
- Each task is executed by exactly one agent.
- Agents modify only the files relevant to their domain.
- Agents must not introduce new libraries without approval.
- Agents output clean diffs or file rewrites upon request.
- Only essential comments are allowed (math references or warnings).

## Execution Model
Codex will:
1. Read the task.
2. Identify the responsible agent.
3. Generate a concise, direct implementation.
4. Apply minimal necessary changes.
5. Produce the updated file(s) only.

---
