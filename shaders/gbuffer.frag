#version 410 core

out vec4 gPositionHeight;   // xyz = world position of first hit, w = terrain height
out vec4 gNormalFlags;      // xyz = normal, w = water coverage (1 water, 0 land, -1 no hit)
out vec4 gMaterial;         // rgb = albedo, a = cloud density placeholder

// Camera + Lighting
uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float aspect;

// Planet Parameters
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float heightScale;
uniform float maxRayDistance;
uniform float seaLevel;
uniform vec2 resolution;

// Water Parameters
uniform vec3 waterColor;
uniform float waterAbsorption;
uniform float waterScattering;

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

vec3 landColor(float h) {
    vec3 ocean = vec3(0.026, 0.16, 0.32);
    vec3 coast = vec3(0.82, 0.75, 0.6);
    vec3 land = vec3(0.16, 0.4, 0.18);
    vec3 mountain = vec3(0.55, 0.56, 0.6);
    vec3 snow = vec3(0.92, 0.95, 0.98);

    float seaLevelHeight = seaLevel;
    float coastBlend = smoothstep(seaLevelHeight - heightScale * 0.14, seaLevelHeight + heightScale * 0.06, h);
    float landBlend = smoothstep(seaLevelHeight + heightScale * 0.03, seaLevelHeight + heightScale * 0.4, h);
    float mountainBlend = smoothstep(seaLevelHeight + heightScale * 0.45, seaLevelHeight + heightScale * 0.7, h);
    float snowBlend = smoothstep(seaLevelHeight + heightScale * 0.75, seaLevelHeight + heightScale * 0.92, h);

    vec3 color = mix(ocean, coast, coastBlend);
    color = mix(color, land, landBlend);
    color = mix(color, mountain, mountainBlend);
    color = mix(color, snow, snowBlend);
    return color;
}

void main() {
    vec2 uv = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;

    vec3 ro = camPos;
    vec3 rd = rayDirection(uv);

    vec3 pos = vec3(0.0);
    float t;
    bool hit = marchPlanet(ro, rd, pos, t);

    float waterRadius = planetRadius + seaLevel;
    float t0, t1;
    bool hitWaterSphere = intersectSphere(ro, rd, waterRadius, t0, t1) && t1 > 0.0;
    if (hitWaterSphere && t0 < 0.0) t0 = 0.0;

    float tTerrain = hit ? t : 1e9;
    float heightValue = hit ? terrainHeight(pos) : -1.0;

    vec3 baseColor = vec3(0.05, 0.07, 0.1);
    float waterFlag = -1.0;
    vec3 normal = normalize(rd);

    if (hit) {
        float d0 = planetSDF(pos);
        normal = computeNormal(pos, d0);
        baseColor = landColor(heightValue);
        waterFlag = 0.0;
    }

    bool waterCoversTerrain = hitWaterSphere && (t0 < tTerrain) && heightValue <= seaLevel;
    if (waterCoversTerrain) {
        vec3 waterSurfacePos = ro + rd * t0;
        pos = waterSurfacePos;
        normal = normalize(waterSurfacePos);
        baseColor = mix(baseColor, waterColor, 0.6);
        waterFlag = 1.0;
    } else if (!hit) {
        pos = ro + rd * maxRayDistance;
    }

    float cloudDensity = 0.0;

    // Only accumulate cloud noise when the view ray actually passes through the
    // atmosphere (or hits the surface). Otherwise distant space renders pick up
    // stray gray cloud patterns.
    float tAtm0, tAtm1;
    bool throughAtmosphere = hit || (intersectSphere(ro, rd, atmosphereRadius, tAtm0, tAtm1) && tAtm1 > 0.0);
    if (throughAtmosphere) {
        cloudDensity = clamp(fbm(normalize(rd) * 2.5 + vec3(0.3, 0.1, -0.4)) * 0.6, 0.0, 1.0);
    }

    gPositionHeight = vec4(pos, heightValue);
    gNormalFlags = vec4(normal, waterFlag);
    gMaterial = vec4(baseColor, cloudDensity);
}
