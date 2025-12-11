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
uniform float atmosphereRadius;
uniform float heightScale;
uniform float seaLevel;
uniform float maxRayDistance;
uniform vec2 resolution;
uniform float aspect;
uniform float cloudBaseAltitude;
uniform float cloudLayerThickness;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform vec3 cloudLightColor;

uniform bool showLayer[9];

// Toggle indices
// 0: sdf (depth visualization)
// 1: height map
// 2: lighting only
// 3: shadow/occlusion debug
// 4: water contribution
// 5: atmosphere scatter
// 6: clouds
// 7: albedo
// 8: final composite

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

float decodeHeight(vec2 uv) {
    return texture(gPositionHeight, uv).w;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec4 decodeMaterial(vec2 uv) {
    return texture(gMaterial, uv);
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

vec4 renderClouds(vec3 rayOrigin, vec3 rayDir, float maxDistance, float coverageHint) {
    float baseRadius = planetRadius + cloudBaseAltitude;
    float topRadius = baseRadius + cloudLayerThickness;

    float tOuter0, tOuter1;
    if (!intersectSphere(rayOrigin, rayDir, topRadius, tOuter0, tOuter1) || tOuter1 <= 0.0) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }

    float tInner0, tInner1;
    bool hitsInner = intersectSphere(rayOrigin, rayDir, baseRadius, tInner0, tInner1);

    float start = max(tOuter0, 0.0);
    if (hitsInner) {
        start = max(start, tInner1);
    }
    float end = min(tOuter1, maxDistance);
    if (end <= start) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }

    const int STEPS = 48;
    float stepSize = (end - start) / float(STEPS);
    vec3 accum = vec3(0.0);
    float transmittance = 1.0;
    vec3 lightDir = normalize(sunDir);

    for (int i = 0; i < STEPS; i++) {
        float t = start + stepSize * (float(i) + 0.5);
        vec3 samplePos = rayOrigin + rayDir * t;

        float density = sampleCloudDensity(samplePos, coverageHint) * cloudDensity;
        if (density < 0.001) {
            continue;
        }

        float lightAmount = clamp(dot(normalize(samplePos), lightDir) * 0.6 + 0.4, 0.0, 1.0);
        float phase = mix(0.55, 1.0, pow(max(dot(rayDir, lightDir), 0.0), 2.5));

        float extinction = density * stepSize * 0.55;
        vec3 scatter = cloudLightColor * density * stepSize * (0.6 + 0.4 * lightAmount) * phase;

        accum += scatter * transmittance;
        transmittance *= exp(-extinction);

        if (transmittance < 0.01) {
            break;
        }
    }

    return vec4(accum, transmittance);
}

float atmosphereDensity(vec3 p) {
    float altitude = length(p) - planetRadius;
    float thickness = max(atmosphereRadius - planetRadius, 0.001);
    float normalized = clamp(1.0 - altitude / thickness, 0.0, 1.0);
    return normalized * normalized;
}

float computeShadow(vec3 pos, vec3 normal) {
    vec3 lightDir = normalize(sunDir);
    float ndl = dot(normal, lightDir);
    float horizon = smoothstep(-0.2, 0.05, ndl);
    return clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * horizon;
}

vec3 shadeWater(vec3 pos, vec3 normal, vec3 albedo, float depth) {
    vec3 lightDir = normalize(sunDir);
    float ndl = max(dot(normal, lightDir), 0.0);
    float fresnel = 0.04 + pow(1.0 - clamp(dot(normal, normalize(pos - camPos)), 0.0, 1.0), 5.0);
    vec3 reflected = albedo * (0.4 + 0.6 * ndl);
    float depthDarken = clamp(depth * 0.06, 0.0, 1.0);
    vec3 transmitted = mix(albedo * 1.35, albedo, depthDarken) * exp(-depth * 0.12);
    vec3 color = mix(transmitted, reflected, fresnel);
    color += pow(max(dot(reflect(-lightDir, normal), normalize(pos - camPos)), 0.0), 48.0) * 0.25;
    return color;
}

vec3 computeAtmosphere(vec3 viewDir, vec3 pos, bool hit) {
    vec3 lightDir = normalize(sunDir);
    vec3 rayOrigin = camPos;
    vec3 rayDir = normalize(viewDir);

    float t0, t1;
    bool intersects = intersectSphere(rayOrigin, rayDir, atmosphereRadius, t0, t1) && t1 > 0.0;
    if (!intersects) {
        return vec3(0.0);
    }

    if (t0 < 0.0) t0 = 0.0;
    float rayEnd = hit ? min(t1, length(pos - rayOrigin)) : t1;
    float pathLength = max(rayEnd - t0, 0.0);

    float viewHeight = max(length(rayOrigin) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeNorm = clamp(viewHeight / atmThickness, 0.0, 1.0);
    float altitudeFalloff = mix(1.0, 0.25, altitudeNorm * altitudeNorm);

    // Encourage a visible horizon glow even when looking almost straight down.
    float horizonDot = clamp(dot(rayDir, normalize(rayOrigin)), -1.0, 1.0);
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 3.5);

    float sunFacing = dot(normalize(rayOrigin + rayDir * max(t0, 0.0)), lightDir);
    float sunWrap = clamp(sunFacing * 0.6 + 0.4, 0.0, 1.0);
    float mieForward = pow(max(dot(rayDir, lightDir), 0.0), 4.0);

    float pathFactor = smoothstep(0.0, atmThickness, pathLength);
    float density = (0.35 + 0.65 * (1.0 - altitudeNorm)) * pathFactor;

    float scatter = horizonFactor * (0.22 + 0.78 * sunWrap) * altitudeFalloff * density;
    scatter += mieForward * 0.08 * sunWrap;
    scatter = max(scatter, 0.02 * pathFactor); // Prevent a totally black atmosphere

    vec3 atmosphereColor = vec3(0.32, 0.58, 0.96);
    return atmosphereColor * scatter;
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    vec3 normal = normalFlags.xyz;
    float waterFlag = normalFlags.w;
    vec4 material = decodeMaterial(uv);
    vec3 albedo = material.rgb;
    float cloudCoverageHint = material.a;

    // gBuffer encodes hits via waterFlag: -1 = miss, 0 = land, 1 = water.
    // Rely on that flag instead of the terrain height sign so land below the
    // reference radius still shades correctly.
    bool hit = waterFlag > -0.5;

    // Layer: SDF depth visualization
    float sdfDepth = clamp(length(pos) / maxRayDistance, 0.0, 1.0);

    // Layer: height map visual (normalized to [-heightScale, +heightScale])
    float heightView = clamp((heightValue + heightScale) / (heightScale * 2.0), 0.0, 1.0);

    // Lighting
    vec3 lightDir = normalize(sunDir);
    float ndl = max(dot(normal, lightDir), 0.0);
    float horizonBlend = smoothstep(0.0, 0.22, ndl);
    float ambient = 0.08;
    float lighting = hit ? clamp(ambient + ndl * horizonBlend, 0.0, 1.0) : 0.0;

    // Shadow proxy
    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    // Water depth approximation relative to sea level
    float waterDepth = (waterFlag > 0.5) ? max(seaLevel - heightValue, 0.0) : 0.0;
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth);

    vec3 color = albedo * lighting;
    if (waterFlag > 0.5) {
        color = waterShaded;
    }
    color *= shadow;

    // Atmosphere layer
    vec3 viewDir = hit ? normalize(pos - camPos) : rayDirection(uv);
    vec3 atmosphere = computeAtmosphere(viewDir, pos, hit);

    float surfaceDistance = hit ? length(pos - camPos) : maxRayDistance;
    vec4 cloudSample = renderClouds(camPos, viewDir, surfaceDistance, cloudCoverageHint);
    vec3 clouds = cloudSample.rgb;
    float cloudTransmittance = cloudSample.a;

    vec3 composite = (color + atmosphere) * cloudTransmittance + clouds;

    if (showLayer[0]) {
        FragColor = vec4(vec3(sdfDepth), 1.0);
        return;
    }
    if (showLayer[1]) {
        FragColor = vec4(vec3(heightView), 1.0);
        return;
    }
    if (showLayer[2]) {
        FragColor = vec4(vec3(lighting), 1.0);
        return;
    }
    if (showLayer[3]) {
        FragColor = vec4(vec3(shadow), 1.0);
        return;
    }
    if (showLayer[4]) {
        FragColor = vec4(waterShaded, 1.0);
        return;
    }
    if (showLayer[5]) {
        FragColor = vec4(atmosphere, 1.0);
        return;
    }
    if (showLayer[6]) {
        FragColor = vec4(clouds, 1.0);
        return;
    }
    if (showLayer[7]) {
        FragColor = vec4(albedo, 1.0);
        return;
    }

    FragColor = vec4(composite, 1.0);
}
