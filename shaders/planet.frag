#version 410 core

out vec4 FragColor;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;

uniform vec3 sunDir;

uniform float aspect;
uniform float time;
uniform float dt;

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
    float warpFreq = 1.3;
    float warpAmp = 0.1;
    vec3 warp = vec3(
        fbm(p * warpFreq + vec3(11.7)),
        fbm(p * warpFreq + vec3(3.9, 17.2, 5.1)),
        fbm(p * warpFreq - vec3(7.5))
    );
    vec3 warpedP = p * 8.0 + (warp - 0.5) * 2.0 * warpAmp;

    float base = fbm(warpedP);
    float detail = fbm(warpedP * 2.5) * 0.35;

    return (base * 0.65 + detail * 0.35) * 0.18;
}

float planetSDF(vec3 p) {
    float r = length(p);
    float h = terrainHeight(p);
    return r - (1.0 + h);
}

// =========================================
// Atmosphere density
// =========================================

float atmosphereDensity(vec3 p) {
    float h = length(p) - 1.0;
    return clamp(1.0 - h / 0.1, 0.0, 1.0);
}

// =========================================
// Clouds as volumetric density
// =========================================

float cloudDensity(vec3 p) {
    if (length(p) < 1.0 || length(p) > 1.1)
        return 0.0;
    return fbm(p * 4.0 + time * 0.05) * 0.5;
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
    float maxDist = 20.0;
    for (int i = 0; i < 200; i++) {
        vec3 p = ro + rd * t;
        float d = planetSDF(p);
        if (d < 0.001) {
            pos = p;
            return true;
        }
        t += d * 0.7;
        if (t > maxDist) break;
    }
    return false;
}

float integrateClouds(vec3 ro, vec3 rd, float tMax) {
    float sum = 0.0;
    float t = 0.0;
    for (int i = 0; i < 40; i++) {
        float k = float(i) / 40.0;
        float ti = k * tMax;
        vec3 p = ro + rd * ti;
        sum += cloudDensity(p) * 0.05;
    }
    return sum;
}

vec3 shadeSurface(vec3 p, vec3 rd) {
    float eps = 0.001;

    float d0 = planetSDF(p);
    float dx = planetSDF(p + vec3(eps,0,0)) - d0;
    float dy = planetSDF(p + vec3(0,eps,0)) - d0;
    float dz = planetSDF(p + vec3(0,0,eps)) - d0;

    vec3 n = normalize(vec3(dx, dy, dz));

    float ndl = max(0.0, dot(n, sunDir));

    float h = terrainHeight(p);

    vec3 ocean = vec3(0.03, 0.12, 0.28);
    vec3 coast = vec3(0.85, 0.76, 0.6);
    vec3 land = vec3(0.1, 0.38, 0.15);
    vec3 mountain = vec3(0.5, 0.5, 0.52);
    vec3 snow = vec3(0.92, 0.95, 0.98);

    float seaLevel = 0.08;
    float coastBlend = smoothstep(seaLevel - 0.025, seaLevel + 0.01, h);
    float landBlend = smoothstep(seaLevel + 0.005, seaLevel + 0.07, h);
    float mountainBlend = smoothstep(seaLevel + 0.09, seaLevel + 0.14, h);
    float snowBlend = smoothstep(seaLevel + 0.15, seaLevel + 0.19, h);

    vec3 color = mix(ocean, coast, coastBlend);
    color = mix(color, land, landBlend);
    color = mix(color, mountain, mountainBlend);
    color = mix(color, snow, snowBlend);

    return color * ndl + color * 0.05;
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

    float viewHeight = max(length(ro) - 1.0, 0.0);
    float altitudeFalloff = exp(-viewHeight * 1.8);

    float sunWrap = clamp(dot(surfaceDir, sunDir) * 0.5 + 0.5, 0.0, 1.0);
    float scatter = horizonFactor * (0.2 + 0.8 * sunWrap) * altitudeFalloff;

    vec3 atmosphereColor = vec3(0.25, 0.45, 0.9);
    return atmosphereColor * scatter;
}

// =========================================
// Main
// =========================================

void main() {
    vec2 uv = (gl_FragCoord.xy / vec2(1280, 720)) * 2.0 - 1.0;

    vec3 ro = camPos;
    vec3 rd = rayDirection(uv);

    vec3 pos;
    float t;

    bool hit = marchPlanet(ro, rd, pos, t);

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 surf = shadeSurface(pos, rd);

        float cloud = integrateClouds(ro, rd, t);
        col = surf + vec3(cloud);
    } else {
        col = vec3(0.05, 0.07, 0.1);
    }

    vec3 atm = computeAtmosphere(ro, rd, hit, pos);

    col += atm;

    FragColor = vec4(col, 1.0);
}
