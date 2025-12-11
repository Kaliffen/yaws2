#version 410 core

out vec4 FragColor;

// =============================================================
// Camera + Lighting
// =============================================================
uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;

uniform vec3 sunDir;

uniform float aspect;

// =============================================================
// Planet Parameters
// =============================================================
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float heightScale;
uniform float maxRayDistance;
uniform vec2 resolution;

// =============================================================
// Water Parameters (new)
// =============================================================
uniform float seaLevel;           // height above planet radius where water begins
uniform vec3 waterColor;          // base water color, e.g. vec3(0.02, 0.12, 0.28)
uniform float waterAbsorption;    // extinction coefficient, e.g. 2.0
uniform float waterScattering;    // forward scattering, e.g. 0.4


// =============================================================
// Helpers
// =============================================================
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


// =============================================================
// Terrain Height and SDF
// =============================================================
float terrainHeight(vec3 p) {
    vec3 scaledP = p / planetRadius;

    float warpFreq = 1.3;
    float warpAmp = 0.08;

    vec3 warp = vec3(
        fbm(scaledP * warpFreq + vec3(11.7)),
        fbm(scaledP * warpFreq + vec3(3.9, 17.2, 5.1)),
        fbm(scaledP * warpFreq - vec3(7.5))
    );

    vec3 warpedP = scaledP * 8.0 + (warp - 0.5) * 2.0 * warpAmp;

    float base = fbm(warpedP);
    float detail = fbm(warpedP * 2.5) * 0.35;

    float normalized = base * 0.62 + detail * 0.38;
    // Bias terrain downward so part of it sits below sea level and forms oceans.
    return (normalized - 0.42) * heightScale;
}

float planetSDF(vec3 p) {
    float r = length(p);
    float h = terrainHeight(p);
    return r - (planetRadius + h);
}


// =============================================================
// Atmosphere
// =============================================================
float atmosphereDensity(vec3 p) {
    float altitude = length(p) - planetRadius;
    float thickness = max(atmosphereRadius - planetRadius, 0.001);
    float normalized = clamp(1.0 - altitude / thickness, 0.0, 1.0);
    return normalized * normalized;
}


// =============================================================
// Ray Helpers
// =============================================================
vec3 rayDirection(vec2 uv) {
    uv.x *= aspect;
    return normalize(camForward + uv.x * camRight + uv.y * camUp);
}

bool marchPlanet(vec3 ro, vec3 rd, out vec3 pos, out float t) {
    t = 0.0;
    float eps = max(heightScale * 0.02, planetRadius * 0.0001);
    for (int i = 0; i < 320; i++) {
        vec3 p = ro + rd * t;
        float d = planetSDF(p);
        if (d < eps) {
            pos = p;
            return true;
        }
        t += max(d * 0.7, eps * 0.5);
        if (t > maxRayDistance) break;
    }
    return false;
}


// =============================================================
// Surface Shading (unchanged)
// =============================================================
vec3 shadeSurface(vec3 p, vec3 rd) {
    float eps = max(planetRadius * 0.0005, heightScale * 0.03);

    float d0 = planetSDF(p);
    float dx = planetSDF(p + vec3(eps,0,0)) - d0;
    float dy = planetSDF(p + vec3(0,eps,0)) - d0;
    float dz = planetSDF(p + vec3(0,0,eps)) - d0;

    vec3 n = normalize(vec3(dx, dy, dz));
    float ndl = dot(n, sunDir);

    float diffuse = max(ndl, 0.0);
    float horizonBlend = smoothstep(0.0, 0.22, diffuse);
    float ambient = 0.06;
    float lighting = clamp(ambient + diffuse * horizonBlend, 0.0, 1.0);

    float h = terrainHeight(p);

    vec3 ocean = vec3(0.026, 0.16, 0.32);
    vec3 coast = vec3(0.82, 0.75, 0.6);
    vec3 landLow = vec3(0.18, 0.42, 0.2);
    vec3 landHigh = vec3(0.36, 0.34, 0.22);
    vec3 landRock = vec3(0.38, 0.36, 0.33);
    vec3 mountain = vec3(0.55, 0.56, 0.6);
    vec3 snow = vec3(0.92, 0.95, 0.98);

    float seaLevelHeight = seaLevel;  // water height (planetRadius + seaLevel)
    float heightAboveSea = h - seaLevelHeight;
    float normalizedHeight = heightAboveSea / max(heightScale, 0.0001);

    // Keep the coastline band thin so inland areas show their intended biomes.
    float coastBlend = smoothstep(-0.06, 0.04, normalizedHeight);
    float landBlend = smoothstep(0.02, 0.32, normalizedHeight);
    float mountainBlend = smoothstep(0.35, 0.62, normalizedHeight);
    float snowBlend = smoothstep(0.65, 0.9, normalizedHeight);

    float heightNorm = clamp(normalizedHeight, 0.0, 1.0);
    float slope = 1.0 - clamp(dot(normalize(p), n), 0.0, 1.0);
    float slopeRock = smoothstep(0.28, 0.7, slope);
    float colorNoise = fbm(normalize(p) * 12.0 + vec3(3.7, 1.3, 6.2));
    float heightMix = clamp(heightNorm * 1.2 + colorNoise * 0.25, 0.0, 1.0);

    vec3 variedLand = mix(landLow, landHigh, heightMix);
    variedLand = mix(variedLand, landRock, slopeRock * 0.65);

    vec3 color = mix(ocean, coast, coastBlend);
    color = mix(color, variedLand, landBlend);
    color = mix(color, mountain, mountainBlend);
    color = mix(color, snow, snowBlend);

    vec3 litColor = color * lighting;

    float surfaceRadius = length(p);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float remainingAtmosphere = clamp(atmosphereRadius - surfaceRadius, 0.0, atmThickness);
    float altitudeFactor = pow(smoothstep(0.0, 1.0, remainingAtmosphere / atmThickness), 1.2);

    float viewFacing = clamp(dot(n, -rd), 0.0, 1.0);
    float horizonFactor = pow(1.0 - viewFacing, 1.15);
    float viewFactor = mix(0.2, 1.0, horizonFactor) * horizonFactor;

    float litSide = smoothstep(0.0, 0.3, ndl);
    vec3 atmosphereTint = vec3(0.08, 0.16, 0.32);
    vec3 tint = atmosphereTint * altitudeFactor * viewFactor * litSide * 0.65;

    return litColor + tint;
}


// =============================================================
// Water: Sphere Intersection
// =============================================================
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


// =============================================================
// Water: Simple Shading
// =============================================================
vec3 shadeWater(vec3 p, vec3 rd, float depth, vec3 floorColor) {
    vec3 n = normalize(p);

    float ndl = max(dot(n, sunDir), 0.0);
    float diffuse = mix(0.2, 1.0, ndl);

    float fresnel = 0.04 + pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
    float spec = pow(max(dot(reflect(-sunDir, n), -rd), 0.0), 24.0) * 0.4;

    float absorption = exp(-waterAbsorption * depth * 0.35);
    float scatter = mix(0.1, 0.35, waterScattering);

    float depthDarken = clamp(depth * 0.08, 0.0, 1.0);
    vec3 transmitted = mix(floorColor * 0.9, waterColor * 1.3, depthDarken) * absorption;
    vec3 reflected = waterColor * (0.4 + 0.6 * ndl);

    vec3 color = mix(transmitted, reflected, fresnel);
    color += spec * (0.2 + scatter);
    color *= diffuse;

    return color;
}


// =============================================================
// Atmosphere
// =============================================================
vec3 computeAtmosphere(vec3 ro, vec3 rd, bool hit, vec3 hitPos) {
    vec3 surfaceDir;
    if (hit) {
        surfaceDir = normalize(hitPos);
    } else {
        float tClosest = max(-dot(ro, rd), 0.0);
        vec3 closest = ro + rd * tClosest;
        surfaceDir = normalize(closest);
    }

    float horizonDot = clamp(dot(rd, surfaceDir), -1.0, 1.0);
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 5.5);

    float viewHeight = max(length(ro) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeNorm = clamp(viewHeight / atmThickness, 0.0, 1.0);
    float altitudeFalloff = mix(1.0, 0.2, altitudeNorm * altitudeNorm);
    float densityAlongView = atmosphereDensity(surfaceDir * planetRadius + surfaceDir * atmThickness * 0.6);

    float sunFacing = dot(surfaceDir, sunDir);
    float sunWrap = clamp(sunFacing * 0.55 + 0.45, 0.0, 1.0);
    float sunVisibility = smoothstep(-0.2, 0.15, sunFacing);
    float mieForward = pow(clamp(0.5 + 0.5 * dot(rd, sunDir), 0.0, 1.0), 4.0);

    float scatter = horizonFactor * (0.18 + 0.82 * sunWrap * sunVisibility)
                  * altitudeFalloff * (0.35 + 0.65 * densityAlongView);
    scatter += mieForward * 0.08 * sunVisibility;

    vec3 atmosphereColor = vec3(0.3, 0.56, 0.96);
    return atmosphereColor * scatter;
}


// =============================================================
// Main
// =============================================================
void main() {
    vec2 uv = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;

    vec3 ro = camPos;
    vec3 rd = rayDirection(uv);

    vec3 pos;
    float t;
    bool hit = marchPlanet(ro, rd, pos, t);

    float waterRadius = planetRadius + seaLevel;

    float t0, t1;
    bool hitWaterSphere = intersectSphere(ro, rd, waterRadius, t0, t1) && t1 > 0.0;
    if (hitWaterSphere && t0 < 0.0) t0 = 0.0;

    float tTerrain = hit ? t : 1e9;
    vec3 terrainColor = vec3(0.0);
    if (hit) {
        terrainColor = shadeSurface(pos, rd);
    }

    bool waterCoversTerrain = hitWaterSphere && (t0 < tTerrain);

    vec3 col = vec3(0.05, 0.07, 0.1);

    if (waterCoversTerrain) {
        float depth = max(min(t1, tTerrain) - t0, 0.0);
        vec3 waterSurfacePos = ro + rd * t0;
        vec3 floorColor = hit ? terrainColor : waterColor;
        col = shadeWater(waterSurfacePos, rd, depth, floorColor);
    } else if (hit) {
        col = terrainColor;
    }

    vec3 atm = computeAtmosphere(ro, rd, hit, pos);
    col += atm;

    FragColor = vec4(col, 1.0);
}
