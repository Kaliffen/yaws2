#version 410 core

#include "planet_common.glsl"

out vec4 gPositionHeight;   // xyz = world position of first hit, w = terrain height
out vec4 gNormalFlags;      // xyz = normal, w = water coverage (1 water, 0 land, -1 no hit)
out vec4 gMaterial;         // rgb = albedo, a = cloud density placeholder

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

// Water Parameters
uniform vec3 waterColor;
uniform float cloudCoverage;

float cloudCoverageField(vec3 dir) {
    float bands = fbm(dir * 3.1 + vec3(1.7, -2.2, 0.5));
    float streaks = fbm(dir * 7.2 + vec3(-4.1, 2.6, 3.3));
    float coverage = bands * 0.65 + streaks * 0.45;
    coverage = coverage * cloudCoverage + 0.12;
    return clamp(smoothstep(0.32, 0.78, coverage), 0.0, 1.0);
}

vec3 rayDirection(vec2 uv) {
    uv.x *= aspect;
    return normalize(camForward + uv.x * camRight + uv.y * camUp);
}

bool marchPlanet(vec3 ro, vec3 rd, out vec3 pos, out float t) {
    t = 0.0;
    float eps = max(heightScale * 0.01, planetRadius * 0.0001);
    for (int i = 0; i < 1024; i++) {
        if (i >= planetMaxSteps) break;
        vec3 p = ro + rd * t;
        float d = planetSDF(p, planetRadius, heightScale);
        if (d < eps) {
            pos = p;
            return true;
        }
        t += max(d * planetStepScale, eps * planetMinStepFactor);
        if (t > maxRayDistance) break;
    }
    return false;
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

    vec3 posPlanet = vec3(0.0);
    float t;
    bool hit = marchPlanet(ro, rd, posPlanet, t);

    float waterRadius = planetRadius + seaLevel;
    float t0, t1;
    bool hitWaterSphere = intersectSphere(ro, rd, waterRadius, t0, t1) && t1 > 0.0;
    if (hitWaterSphere && t0 < 0.0) t0 = 0.0;

    float tTerrain = hit ? t : 1e9;
    float heightValue = hit ? terrainHeight(posPlanet, planetRadius, heightScale) : -1.0;

    vec3 baseColor = vec3(0.05, 0.07, 0.1);
    float waterFlag = -1.0;
    vec3 normalPlanet = normalize(rd);

    if (hit) {
        float d0 = planetSDF(posPlanet, planetRadius, heightScale);
        normalPlanet = computeNormal(posPlanet, d0, planetRadius, heightScale);
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

    gPositionHeight = vec4(posWorld, heightValue);
    gNormalFlags = vec4(normal, waterFlag);
    gMaterial = vec4(baseColor, cloudMask);
}
