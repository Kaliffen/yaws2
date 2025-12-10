## Cloud system fixes

This shader update addresses four stability and quality issues in the cloud renderer:

1. **Shell radius band** – The upper bound mask now uses a decreasing smoothstep (`1.0 - smoothstep`) instead of an inverted edge order. This removes the zero-width band that produced hard rings and ensures a smooth fade between the lower and upper cloud radii.
2. **Color normalization** – Removed the final division of accumulated color by the alpha sum. Keeping the premultiplied accumulation preserves volumetric depth and prevents clouds from collapsing toward flat white halos.
3. **Surface shadow multiplier** – The extra shadowFactor mix on the surface pass was removed. Shadows now come solely from extinction during cloud integration, avoiding double darkening of terrain under cloud cover.
4. **SDF epsilon scaling** – The march epsilon now scales with `heightScale` and a smaller radius term. This improves surface intersection precision on large planets and keeps clouds aligned cleanly to the terrain.

These changes work together to produce softer cloud silhouettes, accurate blending over terrain, and stable shading across different planet sizes.
