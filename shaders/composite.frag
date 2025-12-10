#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float heightScale;
uniform float seaLevel;
uniform float maxRayDistance;
uniform vec2 resolution;

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

float atmosphereDensity(vec3 p) {
    float altitude = length(p) - planetRadius;
    float thickness = max(atmosphereRadius - planetRadius, 0.001);
    float normalized = clamp(1.0 - altitude / thickness, 0.0, 1.0);
    return normalized * normalized;
}

float computeShadow(vec3 pos, vec3 normal) {
    float ndl = dot(normal, sunDir);
    float horizon = smoothstep(-0.2, 0.05, ndl);
    return clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * horizon;
}

vec3 shadeWater(vec3 pos, vec3 normal, vec3 albedo, float depth) {
    float ndl = max(dot(normal, sunDir), 0.0);
    float fresnel = 0.04 + pow(1.0 - clamp(dot(normal, normalize(pos - camPos)), 0.0, 1.0), 5.0);
    vec3 reflected = albedo * (0.4 + 0.6 * ndl);
    vec3 transmitted = albedo * exp(-depth * 0.15);
    vec3 color = mix(transmitted, reflected, fresnel);
    color += pow(max(dot(reflect(-sunDir, normal), normalize(pos - camPos)), 0.0), 48.0) * 0.25;
    return color;
}

vec3 computeAtmosphere(vec3 viewDir, vec3 pos, bool hit) {
    vec3 surfaceDir = hit ? normalize(pos) : normalize(viewDir);
    float horizonDot = clamp(dot(viewDir, surfaceDir), -1.0, 1.0);
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 4.0);

    float viewHeight = max(length(camPos) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeFalloff = exp(-viewHeight / (atmThickness * 0.8));
    float densityAlongView = atmosphereDensity(surfaceDir * planetRadius + surfaceDir * atmThickness * 0.5);

    float sunFacing = dot(surfaceDir, sunDir);
    float sunWrap = clamp(sunFacing * 0.5 + 0.5, 0.0, 1.0);
    float sunVisibility = smoothstep(-0.25, 0.1, sunFacing);

    float scatter = horizonFactor * (0.25 + 0.75 * sunWrap * sunVisibility)
                  * altitudeFalloff * (0.35 + 0.65 * densityAlongView);

    vec3 atmosphereColor = vec3(0.2, 0.42, 0.96);
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

    bool hit = heightValue >= 0.0;

    // Layer: SDF depth visualization
    float sdfDepth = clamp(length(pos) / maxRayDistance, 0.0, 1.0);

    // Layer: height map visual (normalized to [-heightScale, +heightScale])
    float heightView = clamp((heightValue + heightScale) / (heightScale * 2.0), 0.0, 1.0);

    // Lighting
    float ndl = max(dot(normal, sunDir), 0.0);
    float horizonBlend = smoothstep(0.0, 0.22, ndl);
    float ambient = 0.08;
    float lighting = hit ? clamp(ambient + ndl * horizonBlend, 0.0, 1.0) : 0.0;

    // Shadow proxy
    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    // Water depth approximation relative to sea level
    float waterDepth = max((planetRadius + seaLevel) - length(pos), 0.0);
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth);

    vec3 color = albedo * lighting;
    color = mix(color, waterShaded, step(0.5, waterFlag + 1.0));
    color *= shadow;

    // Atmosphere layer
    vec3 viewDir = normalize(pos - camPos);
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
