#version 410 core

layout (location = 0) out vec4 gPositionHeight;   // xyz = world position of first hit, w = terrain height
layout (location = 1) out vec4 gNormalFlags;      // xyz = normal, w = water coverage (1 water, 0 land, -1 no hit)
layout (location = 2) out vec4 gMaterial;         // rgb = albedo, a = precomputed cloud coverage
layout (location = 3) out vec4 gViewData;         // x = view distance, y = atmosphere entry, z = atmosphere exit, w = water path length

// Camera + Lighting
uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float sunPower;
uniform vec3 moonDir;
uniform float moonPower;
uniform float aspect;
uniform float tanHalfFov;

// Planet Parameters
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float heightScale;
uniform float maxRayDistance;
uniform float seaLevel;
uniform int planetMaxSteps;
uniform float planetStepScale;
uniform float planetMinStepFactor;
uniform vec2 resolution;
uniform mat3 planetToWorld;
uniform mat3 worldToPlanet;
uniform float timeSeconds;

// Water Parameters
uniform vec3 waterColor;
uniform float cloudCoverage;

// Terrain generation constants and helpers
const float PLANET_SEED = 1222.0;
const float VERTICAL_EXAGGERATION = 6.0; // 4–8 is realistic
const float BASE_HEIGHT_SCALE = 60.0;   // matches the CPU default
const float CONTINENT_GAIN = 0.48;
const float HILLS_GAIN = 0.32;
const float MOUNTAIN_GAIN = 4.2;
const float PEAK_GAIN = 7.2;
const float OCEAN_DEPTH = 3.8;

float hash(vec3 p) {
    p += PLANET_SEED;
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
            mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
            mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
        f.z
    );
}

float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

float cloudCoverageField(vec3 dir) {
    float bands = fbm(dir * 3.1 + vec3(1.7, -2.2, 0.5));
    float streaks = fbm(dir * 7.2 + vec3(-4.1, 2.6, 3.3));
    float puffs = fbm(dir * 12.5 + vec3(5.1, -1.9, 3.6));
    float coverage = bands * 0.55 + streaks * 0.35 + puffs * 0.25;
    float coverageControl = clamp(cloudCoverage / 1.5, 0.0, 1.0);
    float coverageGain = mix(0.85, 1.85, coverageControl);
    float coverageBias = mix(-0.1, 0.32, coverageControl);
    float adjusted = clamp(coverage * coverageGain + coverageBias, 0.0, 1.0);
    float start = mix(0.44, 0.18, coverageControl);
    float end = mix(0.82, 0.68, coverageControl);
    return clamp(smoothstep(start, end, adjusted), 0.0, 1.0);
}

// Terrain Height and SDF
float continentMask(vec3 n) {
    float plate = fbm(n * 0.35 + vec3(17.3));
    float breakup = fbm(n * 0.8 + vec3(91.7));
    float ocean = fbm(n * 1.6 + vec3(211.3));

    float land = plate * 0.7 + breakup * 0.3;

    land -= smoothstep(0.45, 0.75, ocean) * 0.6;
    land += 0.15;

    return smoothstep(0.35, 0.55, land);
}

float ridged(vec3 p) {
    float sum = 0.0, amp = 0.6, f = 1.0;
    for (int i = 0; i < 6; i++) {
        float n = noise(p * f);
        float r = 1.0 - abs(n * 2.0 - 1.0);
        sum += r * r * amp;
        f *= 2.0;
        amp *= 0.55;
    }
    return clamp(sum, 0.0, 1.0);
}

float terrainHeight(vec3 p) {
    vec3 n = normalize(p);
    float cont = continentMask(n);

    float hills = fbm(n * 4.5);
    float ranges = smoothstep(0.55, 0.78, fbm(n * 5.0 + 17.0)) * cont;

    float m = ridged(n * 10.5);
    float mShape = smoothstep(0.45, 0.95, m);
    float peaks = smoothstep(0.6, 1.0, fbm(n * 65.0));

    float basin = smoothstep(0.3, 0.7, fbm(n * 1.2 + vec3(77.0)));

    float height =
        cont * CONTINENT_GAIN +
        cont * (hills - 0.5) * 2.0 * HILLS_GAIN -
        cont * basin * 0.9 +
        ranges * mShape * MOUNTAIN_GAIN +
        ranges * pow(mShape, 5.0) * PEAK_GAIN * peaks -
        (1.0 - cont) * OCEAN_DEPTH;

    float compressedHeight = height / (1.0 + abs(height) / 7.0);

    // Keep the shader terrain displacement in sync with the CPU's configurable
    // height scale so raymarch bounds and the actual surface agree. The base
    // height scale matches the CPU default, so the factor is 1.0 unless the
    // user changes the slider.
    float heightScaleFactor = heightScale / BASE_HEIGHT_SCALE;
    return compressedHeight * VERTICAL_EXAGGERATION * heightScaleFactor;
}

float planetSDF(vec3 p) {
    float r = length(p);
    float h = terrainHeight(p);
    return r - (planetRadius + h);
}

vec3 rayDirection(vec2 uv) {
    uv.x *= aspect;
    uv *= tanHalfFov;
    return normalize(camForward + uv.x * camRight + uv.y * camUp);
}

float interleavedGradientNoise(vec2 pixel) {
    float f = dot(pixel, vec2(0.06711056, 0.00583715));
    return fract(52.9829189 * fract(f));
}

float computeLodFactor(vec3 ro, vec3 rd) {
    float altitude = max(length(ro) - planetRadius, 0.0);
    float distanceLod = log2(1.0 + altitude / max(planetRadius, 0.0001));
    float horizonAlign = pow(1.0 - abs(dot(normalize(ro), rd)), 2.2);
    return clamp(mix(distanceLod, distanceLod + horizonAlign * 0.5, 0.65), 0.0, 1.0);
}

bool marchPlanet(vec3 ro, vec3 rd, float lodFactor, float jitter, float tMin, float tMax, out vec3 pos, out float t) {
    int stepBudget = int(mix(float(planetMaxSteps), float(planetMaxSteps) * 0.55, lodFactor));
    stepBudget = max(stepBudget, 1);

    float adaptiveScale = mix(planetStepScale * 0.65, planetStepScale * 1.85, lodFactor);
    float minStep = mix(planetMinStepFactor * 0.65, planetMinStepFactor * 1.5, lodFactor);

    float eps = max(heightScale * 0.01, planetRadius * 0.0001);
    t = tMin + eps * jitter;
    for (int i = 0; i < 1024; i++) {
        if (i >= stepBudget) break;
        vec3 p = ro + rd * t;
        float d = planetSDF(p);
        if (d < eps) {
            pos = p;
            return true;
        }
        t += max(d * adaptiveScale, eps * minStep);
        if (t > tMax) break;
    }
    return false;
}

float map(vec3 p) { return planetSDF(p); }

vec3 calcNormal(vec3 p) {
    float elev = length(p) - planetRadius;
    float h = mix(0.018, 0.06, smoothstep(2.0, 18.0, elev));
    vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * map(p + k.xyy * h) +
        k.yyx * map(p + k.yyx * h) +
        k.yxy * map(p + k.yxy * h) +
        k.xxx * map(p + k.xxx * h)
    );
}

vec3 computeNormal(vec3 p) {
    return calcNormal(p);
}

bool intersectSphere(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R*R;
    float h = b*b - c;
    if (h < 0.0) return false;
    h = sqrt(h);
    t0 = -b - h;
    t1 = -b + h;
    return true;
}

vec3 landColor(vec3 p, vec3 normal, float h) {
    vec3 ocean = vec3(0.026, 0.16, 0.32);
    vec3 coast = vec3(0.82, 0.75, 0.6);
    vec3 landLow = vec3(0.18, 0.42, 0.2);
    vec3 landHigh = vec3(0.36, 0.34, 0.22);
    vec3 landRock = vec3(0.38, 0.36, 0.33);
    vec3 mountain = vec3(0.55, 0.56, 0.6);
    vec3 snow = vec3(0.92, 0.95, 0.98);

    float seaLevelHeight = seaLevel;
    float heightAboveSea = h - seaLevelHeight;
    float normalizedHeight = heightAboveSea / max(heightScale, 0.0001);
    normalizedHeight = normalizedHeight * 5;

    // Keep the coastline as a relatively thin band so inland regions pick up the
    // intended greens and browns instead of the sandy coastline tint.
    float coastBlend = smoothstep(-0.06, 0.01, normalizedHeight);
    float landBlend = smoothstep(0.02, 0.32, normalizedHeight);
    float mountainBlend = smoothstep(0.35, 0.62, normalizedHeight);
    float snowBlend = smoothstep(0.65, 0.9, normalizedHeight);

    float heightNorm = clamp(normalizedHeight, 0.0, 1.0);
    float slope = 1.0 - clamp(dot(normalize(p), normal), 0.0, 1.0);
    float slopeRock = smoothstep(0.28, 0.7, slope);
    float colorNoise = fbm(normalize(p) * 12.0 + vec3(3.7, 1.3, 6.2));
    float heightMix = clamp(heightNorm * 1.2 + colorNoise * 0.25, 0.0, 1.0);

    vec3 variedLand = mix(landLow, landHigh, heightMix);
    variedLand = mix(variedLand, landRock, slopeRock * 0.65);

    vec3 color = mix(ocean, coast, coastBlend);
    color = mix(color, variedLand, landBlend);
    color = mix(color, mountain, mountainBlend);
    color = mix(color, snow, snowBlend);
    return color;
}

void main() {
    vec2 uv = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;

    vec3 roWorld = camPos;
    vec3 rdWorld = rayDirection(uv);
    vec3 ro = worldToPlanet * roWorld;
    vec3 rd = worldToPlanet * rdWorld;

    float jitter = interleavedGradientNoise(gl_FragCoord.xy + timeSeconds);
    float lodFactor = computeLodFactor(ro, rd);

    float tAtm0 = 0.0;
    float tAtm1 = 0.0;
    bool hitsAtmosphere = intersectSphere(ro, rd, atmosphereRadius, tAtm0, tAtm1);

    float tPlanet0 = 0.0;
    float tPlanet1 = 0.0;
    bool hitsPlanetShell = intersectSphere(ro, rd, planetRadius, tPlanet0, tPlanet1);

    float waterRadius = planetRadius + seaLevel;
    float tWater0 = 0.0;
    float tWater1 = 0.0;
    bool hitWaterSphere = intersectSphere(ro, rd, waterRadius, tWater0, tWater1) && tWater1 > 0.0;
    if (hitWaterSphere && tWater0 < 0.0) tWater0 = 0.0;

    float marchStart = 0.0;
    float marchEnd = maxRayDistance;

    if (hitsAtmosphere && tAtm1 > 0.0) {
        marchStart = max(tAtm0, 0.0);
        marchEnd = min(tAtm1, maxRayDistance);
    } else if (length(ro) > atmosphereRadius && (!hitsAtmosphere || tAtm1 <= 0.0)) {
        marchStart = maxRayDistance;
        marchEnd = maxRayDistance;
    }

    float shellPadding = max(heightScale * 1.2, planetRadius * 0.001);

    if (hitsPlanetShell && tPlanet1 > 0.0) {
        float entry = max(tPlanet0, 0.0);
        marchStart = max(marchStart, max(entry - shellPadding, 0.0));
        marchEnd = min(marchEnd, tPlanet1 + shellPadding);
    }

    if (hitWaterSphere) {
        marchStart = max(marchStart, max(tWater0 - shellPadding, 0.0));
        marchEnd = min(marchEnd, tWater1 + shellPadding);
    }

    vec3 posPlanet = vec3(0.0);
    float t;
    bool withinSegment = marchEnd > marchStart;
    bool hit = withinSegment && marchPlanet(ro, rd, lodFactor, jitter, marchStart, marchEnd, posPlanet, t);

    float tTerrain = hit ? t : 1e9;
    float heightValue = hit ? terrainHeight(posPlanet) : -1.0;

    vec3 baseColor = vec3(0.05, 0.07, 0.1);
    float waterFlag = -1.0;
    vec3 normalPlanet = normalize(rd);

    if (hit) {
        normalPlanet = computeNormal(posPlanet);
        baseColor = landColor(posPlanet, normalPlanet, heightValue);
        waterFlag = 0.0;
    }

    bool waterCoversTerrain = hitWaterSphere && (tWater0 < tTerrain) && heightValue <= seaLevel;
    if (waterCoversTerrain) {
        vec3 waterSurfacePos = ro + rd * tWater0;
        posPlanet = waterSurfacePos;
        normalPlanet = normalize(waterSurfacePos);
        // Preserve the underlying terrain color so the lighting pass can
        // treat the water as a transparent volume hovering above it.
        waterFlag = 1.0;
    } else if (!hit) {
        posPlanet = ro + rd * marchEnd;
    }

    bool throughAtmosphere = hit || (hitsAtmosphere && tAtm1 > 0.0);

    vec3 posWorld = planetToWorld * posPlanet;
    vec3 normal = normalize(planetToWorld * normalPlanet);

    float viewDistance = length(posWorld - camPos);

    float waterPath = 0.0;
    if (hitWaterSphere) {
        float waterExit = min(tWater1, viewDistance);
        if (waterExit > tWater0) {
            waterPath = waterExit - tWater0;
        }
    }

    float atmEntry = 0.0;
    float atmExit = 0.0;
    if (throughAtmosphere) {
        atmEntry = max(tAtm0, 0.0);
        atmExit = min(tAtm1, maxRayDistance);
    }

    float coverageHint = cloudCoverageField(normalize(posPlanet));

    gPositionHeight = vec4(posWorld, heightValue);
    gNormalFlags = vec4(normal, waterFlag);
    gMaterial = vec4(baseColor, coverageHint);
    gViewData = vec4(viewDistance, atmEntry, atmExit, waterPath);
}
