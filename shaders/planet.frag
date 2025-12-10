#version 410 core

out vec4 FragColor;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;

uniform vec3 sunDir;

uniform float aspect;

uniform float planetRadius;
uniform float atmosphereRadius;
uniform float heightScale;
uniform float maxRayDistance;
uniform vec2 resolution;

// =========================================
// Helpers
// =========================================

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

// =========================================
// Planet SDF with height map
// =========================================

float terrainHeight(vec3 p) {
    // Sample terrain in normalized planet space so the patterns stay consistent
    // as the planet radius scales up.
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

    float normalized = base * 0.65 + detail * 0.35;
    return normalized * heightScale;
}

float planetSDF(vec3 p) {
    float r = length(p);
    float h = terrainHeight(p);
    return r - (planetRadius + h);
}

// =========================================
// Atmosphere density
// =========================================

float atmosphereDensity(vec3 p) {
    float altitude = length(p) - planetRadius;
    float thickness = max(atmosphereRadius - planetRadius, 0.001);
    float normalized = clamp(1.0 - altitude / thickness, 0.0, 1.0);
    return normalized * normalized;
}

// =========================================
// Raymarch
// =========================================

vec3 rayDirection(vec2 uv) {
    uv.x *= aspect;
    vec3 rd = normalize(camForward + uv.x * camRight + uv.y * camUp);
    return rd;
}

bool marchPlanet(vec3 ro, vec3 rd, out vec3 pos, out float t) {
    t = 0.0;
    float maxDist = maxRayDistance;
    float eps = max(heightScale * 0.02, planetRadius * 0.0001);
    for (int i = 0; i < 320; i++) {
        vec3 p = ro + rd * t;
        float d = planetSDF(p);
        if (d < eps) {
            pos = p;
            return true;
        }
        t += max(d * 0.7, eps * 0.5);
        if (t > maxDist) break;
    }
    return false;
}

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

    vec3 ocean = vec3(0.03, 0.12, 0.28);
    vec3 coast = vec3(0.85, 0.76, 0.6);
    vec3 land = vec3(0.1, 0.38, 0.15);
    vec3 mountain = vec3(0.5, 0.5, 0.52);
    vec3 snow = vec3(0.92, 0.95, 0.98);

    float seaLevel = heightScale * 0.45;
    float coastBlend = smoothstep(seaLevel - heightScale * 0.14, seaLevel + heightScale * 0.06, h);
    float landBlend = smoothstep(seaLevel + heightScale * 0.03, seaLevel + heightScale * 0.4, h);
    float mountainBlend = smoothstep(seaLevel + heightScale * 0.45, seaLevel + heightScale * 0.7, h);
    float snowBlend = smoothstep(seaLevel + heightScale * 0.75, seaLevel + heightScale * 0.92, h);

    vec3 color = mix(ocean, coast, coastBlend);
    color = mix(color, land, landBlend);
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
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 5.0);

    float viewHeight = max(length(ro) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeFalloff = exp(-viewHeight / (atmThickness * 0.8));
    float densityAlongView = atmosphereDensity(surfaceDir * planetRadius + surfaceDir * atmThickness * 0.5);

    float sunFacing = dot(surfaceDir, sunDir);
    float sunWrap = clamp(sunFacing * 0.5 + 0.5, 0.0, 1.0);
    float sunVisibility = smoothstep(-0.25, 0.15, sunFacing);
    float scatter = horizonFactor * (0.15 + 0.85 * sunWrap * sunVisibility) * altitudeFalloff * (0.35 + 0.65 * densityAlongView);

    vec3 atmosphereColor = vec3(0.25, 0.45, 0.9);
    return atmosphereColor * scatter;
}

// =========================================
// Main
// =========================================

void main() {
    vec2 uv = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;

    vec3 ro = camPos;
    vec3 rd = rayDirection(uv);

    vec3 pos;
    float t;

    bool hit = marchPlanet(ro, rd, pos, t);

    vec3 col = vec3(0.05, 0.07, 0.1);

    if (hit) {
        col = shadeSurface(pos, rd);
    }

    vec3 atm = computeAtmosphere(ro, rd, hit, pos);

    col += atm;

    FragColor = vec4(col, 1.0);
}
