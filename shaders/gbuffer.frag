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

    float warpFreq = 1.15;
    float warpAmp = 0.06;

    vec3 warp = vec3(
        fbm(scaledP * warpFreq + vec3(11.7)),
        fbm(scaledP * warpFreq + vec3(3.9, 17.2, 5.1)),
        fbm(scaledP * warpFreq - vec3(7.5))
    );

    vec3 warpedP = scaledP * 8.0 + (warp - 0.5) * 2.0 * warpAmp;

    float base = fbm(warpedP);
    float detail = fbm(warpedP * 2.5) * 0.35;

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

bool marchPlanet(vec3 ro, vec3 rd, float lodFactor, float jitter, out vec3 pos, out float t) {
    int stepBudget = int(mix(float(planetMaxSteps), float(planetMaxSteps) * 0.55, lodFactor));
    stepBudget = max(stepBudget, 1);

    float adaptiveScale = mix(planetStepScale * 0.65, planetStepScale * 1.85, lodFactor);
    float minStep = mix(planetMinStepFactor * 0.65, planetMinStepFactor * 1.5, lodFactor);

    float eps = max(heightScale * 0.01, planetRadius * 0.0001);
    t = eps * jitter;
    for (int i = 0; i < 1024; i++) {
        if (i >= stepBudget) break;
        vec3 p = ro + rd * t;
        float d = planetSDF(p);
        if (d < eps) {
            pos = p;
            return true;
        }
        t += max(d * adaptiveScale, eps * minStep);
        if (t > maxRayDistance) break;
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

    vec3 posPlanet = vec3(0.0);
    float t;
    bool hit = marchPlanet(ro, rd, lodFactor, jitter, posPlanet, t);

    float waterRadius = planetRadius + seaLevel;
    float t0, t1;
    bool hitWaterSphere = intersectSphere(ro, rd, waterRadius, t0, t1) && t1 > 0.0;
    if (hitWaterSphere && t0 < 0.0) t0 = 0.0;

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

    bool waterCoversTerrain = hitWaterSphere && (t0 < tTerrain) && heightValue <= seaLevel;
    if (waterCoversTerrain) {
        vec3 waterSurfacePos = ro + rd * t0;
        posPlanet = waterSurfacePos;
        normalPlanet = normalize(waterSurfacePos);
        // Preserve the underlying terrain color so the lighting pass can
        // treat the water as a transparent volume hovering above it.
        waterFlag = 1.0;
    } else if (!hit) {
        posPlanet = ro + rd * maxRayDistance;
    }

    float cloudMask = 0.0;

    // Only accumulate cloud noise when the view ray actually passes through the
    // atmosphere (or hits the surface). Otherwise distant space renders pick up
    // stray gray cloud patterns.
    float tAtm0, tAtm1;
    bool throughAtmosphere = hit || (intersectSphere(ro, rd, atmosphereRadius, tAtm0, tAtm1) && tAtm1 > 0.0);
    if (throughAtmosphere) {
        vec3 coverageSample = hit ? posPlanet : (ro + rd * min(maxRayDistance, max(tAtm1, 0.0)));
        cloudMask = cloudCoverageField(normalize(coverageSample));
    }

    vec3 posWorld = planetToWorld * posPlanet;
    vec3 normal = normalize(planetToWorld * normalPlanet);

    float viewDistance = length(posWorld - camPos);

    float waterPath = 0.0;
    if (hitWaterSphere) {
        float waterExit = min(t1, viewDistance);
        if (waterExit > t0) {
            waterPath = waterExit - t0;
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
