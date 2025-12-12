#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float planetRadius;
uniform float cloudBaseAltitude;
uniform float cloudLayerThickness;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform vec3 cloudLightColor;
uniform float maxRayDistance;
uniform float aspect;
uniform int cloudMaxSteps;
uniform float cloudExtinction;
uniform float cloudPhaseExponent;

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
    vec3 u = f * f * (3.0 - 2.0 * f);
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

float cloudShapeNoise(vec3 p) {
    vec3 normalizedP = p / planetRadius;
    float base = fbm(normalizedP * 22.0 + vec3(8.2, 1.7, -3.4));
    float detail = fbm(normalizedP * 64.0 - vec3(4.1, 5.6, 2.0));
    float billow = abs(fbm(normalizedP * 12.0 + vec3(-6.0, 2.5, 4.3)) * 2.0 - 1.0);
    return base * 0.55 + detail * 0.3 + billow * 0.15;
}

float sampleCloudDensity(vec3 p, float coverageHint) {
    float layerBaseRadius = planetRadius + cloudBaseAltitude;
    float heightNorm = clamp((length(p) - layerBaseRadius) / max(cloudLayerThickness, 0.001), 0.0, 1.0);

    float coverage = cloudCoverageField(normalize(p));
    coverage = mix(coverage, coverageHint, 0.25);

    float shape = cloudShapeNoise(p);
    float density = (shape - 0.4) * 1.6;
    density = clamp(density * coverage, 0.0, 1.0);

    float bottomFade = smoothstep(0.08, 0.22, heightNorm);
    float topFade = 1.0 - smoothstep(0.65, 0.98, heightNorm);
    return density * bottomFade * topFade;
}

vec3 rayDirection(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    uv.x *= aspect;
    return normalize(camForward + uv.x * camRight + uv.y * camUp);
}

bool intersectSphere(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float h = b * b - c;
    if (h < 0.0) return false;
    h = sqrt(h);
    t0 = -b - h;
    t1 = -b + h;
    return true;
}

vec4 raymarchClouds(vec3 rayOrigin, vec3 rayDir, float maxDistance, float coverageHint) {
    float baseRadius = planetRadius + cloudBaseAltitude;
    float topRadius = baseRadius + cloudLayerThickness;

    float tOuter0, tOuter1;
    if (!intersectSphere(rayOrigin, rayDir, topRadius, tOuter0, tOuter1) || tOuter1 <= 0.0) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }

    float tInner0, tInner1;
    bool hitsInner = intersectSphere(rayOrigin, rayDir, baseRadius, tInner0, tInner1);

    float start = max(tOuter0, 0.0);

    // When the camera is below the cloud base (inside the inner sphere), skip
    // forward to the exit so we only march through the actual cloud volume.
    // Otherwise, keep the outer entry so near-side cloud density still blends
    // over the surface instead of popping in only above the base radius.
    if (hitsInner && tInner0 < 0.0) {
        start = max(start, tInner1);
    }
    float end = min(tOuter1, maxDistance);
    if (end <= start) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }

    float stepSize = (end - start) / max(float(cloudMaxSteps), 1.0);
    vec3 accum = vec3(0.0);
    float transmittance = 1.0;
    vec3 lightDir = normalize(sunDir);

    for (int i = 0; i < 256; i++) {
        if (i >= cloudMaxSteps) break;
        float t = start + stepSize * (float(i) + 0.5);
        vec3 samplePos = rayOrigin + rayDir * t;

        float density = sampleCloudDensity(samplePos, coverageHint) * cloudDensity;
        if (density < 0.001) {
            continue;
        }

        float lightAmount = smoothstep(0.0, 0.18, dot(normalize(samplePos), lightDir));
        float phase = mix(0.55, 1.0, pow(max(dot(rayDir, lightDir), 0.0), cloudPhaseExponent));

        float extinction = density * stepSize * cloudExtinction;
        vec3 scatter = cloudLightColor * density * stepSize * lightAmount * mix(0.35, 1.0, phase);

        accum += scatter * transmittance;
        transmittance *= exp(-extinction);

        if (transmittance < 0.01) {
            break;
        }
    }

    return vec4(accum, transmittance);
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = texture(gPositionHeight, uv).xyz;
    vec4 normalFlags = texture(gNormalFlags, uv);
    vec4 material = texture(gMaterial, uv);
    bool hit = normalFlags.w > -0.5;

    vec3 viewDir = hit ? normalize(pos - camPos) : rayDirection(uv);
    float surfaceDistance = hit ? length(pos - camPos) : maxRayDistance;
    vec4 clouds = raymarchClouds(camPos, viewDir, surfaceDistance, material.a);

    FragColor = clouds;
}
