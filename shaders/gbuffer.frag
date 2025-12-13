#version 410 core

layout (location = 0) out vec4 gPositionHeight;   // xyz = world position of first hit, w = terrain height
layout (location = 1) out vec4 gNormalFlags;      // xyz = normal, w = water coverage (1 water, 0 land, -1 no hit)
layout (location = 2) out vec4 gMaterial;         // rgb = albedo, a = cloud density placeholder
layout (location = 3) out vec4 gViewData;         // x = view distance, y = atmosphere entry, z = atmosphere exit, w = water path length

// Camera + Lighting
uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float sunPower;
uniform float aspect;

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

// Helpers
float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float n000 = hash(i + vec3(0,0,0));
    float n001 = hash(i + vec3(0,0,1));
    float n010 = hash(i + vec3(0,1,0));
    float n011 = hash(i + vec3(0,1,1));
    float n100 = hash(i + vec3(1,0,0));
    float n101 = hash(i + vec3(1,0,1));
    float n110 = hash(i + vec3(1,1,0));
    float n111 = hash(i + vec3(1,1,1));
    vec3 u = f*f*(3.0 - 2.0*f);
    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    );
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

float cloudCoverageField(vec3 dir) {
    float bands = fbm(dir * 3.1 + vec3(1.7, -2.2, 0.5));
    float streaks = fbm(dir * 7.2 + vec3(-4.1, 2.6, 3.3));
    float coverage = bands * 0.65 + streaks * 0.45;
    coverage = coverage * cloudCoverage + 0.12;
    return clamp(smoothstep(0.32, 0.78, coverage), 0.0, 1.0);
}

// Terrain Height and SDF
float terrainHeight(vec3 p) {
    vec3 scaledP = p / planetRadius;
    float altitude = max(length(p) - planetRadius, 0.0);
    float detailFade = clamp(1.0 - altitude / max(heightScale * 6.0, 0.0001), 0.0, 1.0);
    float octaveBudget = mix(2.0, 5.0, detailFade);

    float warpFreq = 1.15;
    float warpAmp = 0.06;

    vec3 warp = vec3(
        fbm(scaledP * warpFreq + vec3(11.7)),
        fbm(scaledP * warpFreq + vec3(3.9, 17.2, 5.1)),
        fbm(scaledP * warpFreq - vec3(7.5))
    );

    vec3 warpedP = scaledP * 8.0 + (warp - 0.5) * 2.0 * warpAmp;

    float base = fbm(warpedP);
    float detail = 0.0;

    for (int i = 0; i < 3; ++i) {
        if (float(i) > octaveBudget - 3.0) break;
        detail += fbm(warpedP * (2.5 + float(i))) * 0.12;
    }

    float normalized = base * 0.62 + detail * 0.38;
    // Bias the terrain downward so a portion of the surface sits below sea level,
    // revealing oceans instead of an all-land sphere.
    return (normalized - 0.42) * heightScale;
}

float planetSDF(vec3 p) {
    float r = length(p);
    float h = terrainHeight(p);
    return r - (planetRadius + h);
}

vec3 rayDirection(vec2 uv) {
    uv.x *= aspect;
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
    float shellSlack = max(heightScale * 1.1, planetRadius * 0.001);
    t = tMin + eps * jitter;
    for (int i = 0; i < 1024; i++) {
        if (i >= stepBudget) break;
        vec3 p = ro + rd * t;
        float sphereD = length(p) - (planetRadius + shellSlack);
        if (sphereD > shellSlack * 0.5) {
            t += max(sphereD * adaptiveScale, eps * minStep);
            if (t > tMax) break;
            continue;
        }

        float d = planetSDF(p);
        if (d < eps) {
            pos = p;
            return true;
        }
        float stepDist = max(d * adaptiveScale, eps * minStep);
        t += stepDist * 0.9;
        if (t > tMax) break;
    }
    return false;
}

vec3 computeNormal(vec3 p, float d0) {
    float eps = max(planetRadius * 0.0005, heightScale * 0.03);
    float dx = planetSDF(p + vec3(eps,0,0)) - d0;
    float dy = planetSDF(p + vec3(0,eps,0)) - d0;
    float dz = planetSDF(p + vec3(0,0,eps)) - d0;
    return normalize(vec3(dx, dy, dz));
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
    vec3 ocean = waterColor;
    vec3 coast = vec3(0.72, 0.67, 0.58);
    vec3 landLow = vec3(0.19, 0.37, 0.24);
    vec3 landHigh = vec3(0.32, 0.38, 0.26);
    vec3 landRock = vec3(0.37, 0.36, 0.33);
    vec3 mountain = vec3(0.54, 0.58, 0.62);
    vec3 snow = vec3(0.93, 0.96, 0.99);

    float seaLevelHeight = seaLevel;
    float heightAboveSea = h - seaLevelHeight;
    float normalizedHeight = heightAboveSea / max(heightScale, 0.0001);
    normalizedHeight = normalizedHeight * 3.8;

    // Keep the coastline as a thin, cool band and avoid yellow outlines by
    // narrowing the blend region and desaturating the sand tone.
    float coastBlend = smoothstep(-0.05, 0.02, normalizedHeight);
    float landBlend = smoothstep(0.02, 0.30, normalizedHeight);
    float mountainBlend = smoothstep(0.28, 0.60, normalizedHeight);
    float snowBlend = smoothstep(0.55, 0.85, normalizedHeight);

    float heightNorm = clamp(normalizedHeight, 0.0, 1.0);
    float slope = 1.0 - clamp(dot(normalize(p), normal), 0.0, 1.0);
    float slopeRock = smoothstep(0.26, 0.66, slope);
    float colorNoise = fbm(normalize(p) * 12.0 + vec3(3.7, 1.3, 6.2));
    float heightMix = clamp(heightNorm * 1.1 + colorNoise * 0.22, 0.0, 1.0);

    vec3 variedLand = mix(landLow, landHigh, heightMix);
    variedLand = mix(variedLand, landRock, slopeRock * 0.6);

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
        float d0 = planetSDF(posPlanet);
        normalPlanet = computeNormal(posPlanet, d0);
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

    float cloudMask = 0.0;

    // Only accumulate cloud noise when the view ray actually passes through the
    // atmosphere (or hits the surface). Otherwise distant space renders pick up
    // stray gray cloud patterns.
    bool throughAtmosphere = hit || (hitsAtmosphere && tAtm1 > 0.0);
    if (throughAtmosphere) {
        vec3 coverageSample = hit ? posPlanet : (ro + rd * min(maxRayDistance, max(tAtm1, 0.0)));
        cloudMask = cloudCoverageField(normalize(coverageSample));
    }

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

    gPositionHeight = vec4(posWorld, heightValue);
    gNormalFlags = vec4(normal, waterFlag);
    gMaterial = vec4(baseColor, cloudMask);
    gViewData = vec4(viewDistance, atmEntry, atmExit, waterPath);
}
