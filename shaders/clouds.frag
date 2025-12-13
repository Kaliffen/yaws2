#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D gViewData;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float sunPower;
uniform float planetRadius;
uniform float cloudBaseAltitude;
uniform float cloudLayerThickness;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform float cloudWorldCoverage;
uniform vec3 cloudLightColor;
uniform float maxRayDistance;
uniform float aspect;
uniform int cloudMaxSteps;
uniform float cloudExtinction;
uniform float cloudPhaseExponent;
uniform float cloudAnimationSpeed;
uniform mat3 worldToPlanet;
uniform float timeSeconds;

vec3 computeSunTint(vec3 upDir, vec3 lightDir) {
    float sunHeight = clamp(dot(upDir, lightDir), -1.0, 1.0);

    float dayFactor = smoothstep(-0.08, 0.12, sunHeight);
    float goldenBand = 1.0 - smoothstep(0.01, 0.50, abs(sunHeight));

    vec3 nightColor = vec3(0.03, 0.06, 0.10);
    vec3 dayColor = vec3(0.46, 0.46, 0.42);
    vec3 goldenColor = vec3(1.04, 0.70, 0.44);
    vec3 twilightColor = vec3(0.44, 0.34, 0.56);

    vec3 warmBlend = mix(dayColor, goldenColor, goldenBand * 2.15);
    vec3 base = mix(nightColor, warmBlend, dayFactor);
    return mix(base, twilightColor, goldenBand * 0.18);
}

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

mat3 rotationY(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

float interleavedGradientNoise(vec2 pixel) {
    float f = dot(pixel, vec2(0.06711056, 0.00583715));
    return fract(52.9829189 * fract(f));
}

float cloudCoverageField(vec3 dir) {
    float cloudTime = timeSeconds * cloudAnimationSpeed;
    vec3 flowOffset = vec3(cloudTime * 0.00035, 0.0, cloudTime * 0.00055);
    vec3 lookup = dir * 2.6 + vec3(1.25, -0.45, 0.65) + flowOffset;

    float base = fbm(lookup);
    float billow = 1.0 - abs(fbm(lookup * 1.9 + vec3(-2.0, 3.1, 0.5)) * 2.0 - 1.0);
    float coverage = mix(base, billow, 0.55);
    coverage = coverage * (cloudCoverage + 0.35) + 0.15;
    coverage *= cloudWorldCoverage;
    return clamp(smoothstep(0.28, 0.68, coverage), 0.0, 1.0);
}

float cloudShapeNoise(vec3 p) {
    vec3 normalizedP = p / planetRadius;
    float cloudTime = timeSeconds * cloudAnimationSpeed;
    vec3 flowOffset = vec3(cloudTime * 0.0011, cloudTime * 0.0005, -cloudTime * 0.0008);
    vec3 warped = normalizedP + flowOffset;

    float base = fbm(warped * 18.0 + vec3(6.1, 0.9, -2.4));
    float billow = abs(fbm(warped * 9.5 + vec3(-3.0, 2.2, 3.8)) * 2.0 - 1.0);
    float detail = fbm(warped * 42.0 - vec3(2.6, 4.8, 1.4));
    return base * 0.45 + billow * 0.4 + detail * 0.25;
}

float sampleCloudDensity(vec3 p, float coverageHint) {
    float layerBaseRadius = planetRadius + cloudBaseAltitude;
    float heightNorm = clamp((length(p) - layerBaseRadius) / max(cloudLayerThickness, 0.001), 0.0, 1.0);

    float coverage = cloudCoverageField(normalize(p));
    coverage = mix(coverage, coverageHint, 0.35);

    float shape = cloudShapeNoise(p);
    float density = (shape - 0.48) * 2.1;
    density = clamp(density * coverage, 0.0, 1.0);

    float bottomFade = smoothstep(0.04, 0.24, heightNorm);
    float topFade = 1.0 - smoothstep(0.6, 0.95, heightNorm);
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

float computeDistanceLod(float surfaceDistance) {
    float normalized = log2(1.0 + surfaceDistance / max(planetRadius, 0.0001));
    return clamp(normalized * 0.55, 0.0, 1.0);
}

vec4 raymarchClouds(vec3 rayOrigin, vec3 rayDir, float maxDistance, float coverageHint, float distanceLod, float jitter) {
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

    int adaptiveSteps = int(mix(float(cloudMaxSteps), float(cloudMaxSteps) * 0.35, distanceLod));
    adaptiveSteps = clamp(adaptiveSteps, 4, min(cloudMaxSteps, 256));
    float stepSize = (end - start) / float(adaptiveSteps);
    float jitterOffset = jitter - 0.5;
    vec3 accum = vec3(0.0);
    float transmittance = 1.0;
    vec3 lightDir = normalize(worldToPlanet * sunDir);

    for (int i = 0; i < 256; i++) {
        if (i >= adaptiveSteps) break;
        float t = start + stepSize * (float(i) + 0.5 + jitterOffset);
        vec3 samplePos = rayOrigin + rayDir * t;

        vec3 localNormal = normalize(samplePos);
        float sunHeight = dot(localNormal, lightDir);
        float density = sampleCloudDensity(samplePos, coverageHint) * cloudDensity;
        density *= mix(1.0, 0.68, distanceLod);

        // Thin clouds along grazing angles so the horizon view doesn't look overly
        // opaque. When the view ray is nearly tangent to the planet surface the dot
        // product between the ray and the local normal approaches zero; in that
        // case, gently reduce density instead of letting the long march path fully
        // accumulate.
        float viewAlignment = abs(dot(-rayDir, normalize(samplePos)));
        float horizonFade = mix(0.25, 1.0, smoothstep(0.05, 0.35, viewAlignment));
        density *= horizonFade;
        if (density < 0.001) {
            continue;
        }

        float lightAmount = smoothstep(0.02, 0.18, sunHeight);
        float sunVisibility = smoothstep(-0.28, 0.05, sunHeight);
        float forwardScatter = pow(max(dot(rayDir, lightDir), 0.0), cloudPhaseExponent);
        float phase = mix(0.42, 0.78, forwardScatter);
        float lowLightAtten = mix(0.4, 1.0, sunVisibility);
        float diffuseDimming = mix(0.55, 1.0, lightAmount);
        float twilightMask = smoothstep(-0.25, 0.05, sunHeight) * (1.0 - lightAmount);
        float twilightDimming = mix(0.6, 1.0, 1.0 - twilightMask * 0.7);

        float extinction = density * stepSize * cloudExtinction;

        float sunIntensity = max(sunPower, 0.0);
        vec3 sunColor = computeSunTint(localNormal, lightDir) * sunIntensity;
        vec3 directLight = cloudLightColor * sunColor * lightAmount * mix(0.4, 0.82, phase) * sunVisibility * lowLightAtten;
        directLight *= mix(0.55, 1.0, lightAmount + sunVisibility * 0.35);
        vec3 ambient = mix(vec3(0.02, 0.025, 0.03), vec3(0.08, 0.10, 0.12), sunVisibility) * lowLightAtten;
        ambient *= mix(0.5, 1.0, lightAmount + sunVisibility * 0.5);
        vec3 warmTwilight = vec3(0.12, 0.09, 0.10) * twilightMask * sunIntensity * 0.18 * lowLightAtten;

        vec3 scatter = (directLight + ambient * cloudLightColor + warmTwilight) * density * stepSize * diffuseDimming * twilightDimming;

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
    vec4 viewData = texture(gViewData, uv);
    bool hit = normalFlags.w > -0.5;

    vec3 camPlanet = worldToPlanet * camPos;
    vec3 viewDirWorld = hit ? normalize(pos - camPos) : rayDirection(uv);
    vec3 viewDirPlanet = normalize(worldToPlanet * viewDirWorld);
    float surfaceDistance = viewData.x;
    float distanceLod = computeDistanceLod(surfaceDistance);
    float jitter = interleavedGradientNoise(gl_FragCoord.xy + timeSeconds);
    vec4 clouds = raymarchClouds(camPlanet, viewDirPlanet, surfaceDistance, material.a, distanceLod, jitter);

    FragColor = clouds;
}
