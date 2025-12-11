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
    float cloudDensity = material.a;

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

    // Cloud layer
    vec3 clouds = vec3(cloudDensity) * vec3(1.0, 0.95, 0.9) * 0.5;

    vec3 composite = color + atmosphere + clouds;

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
