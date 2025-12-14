#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D gViewData;
uniform sampler2D lightingTex;
uniform sampler2D atmosphereTex;
uniform sampler2D cloudTex;

uniform float heightScale;
uniform float maxRayDistance;

uniform int debugLevel;

// Camera + Lighting
uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float sunPower;
uniform vec3 moonDir;
uniform float moonPower;
uniform float aspect;
uniform float tanHalfFov;
uniform float planetRadius;
uniform float atmosphereRadius;

// Debug levels (1-9)
// 1: sdf (depth visualization)
// 2: height map
// 3: albedo
// 4: shadowed albedo
// 5: lit surface (lighting buffer)
// 6: lit surface with atmospheric attenuation
// 7: add atmospheric scattering
// 8: apply cloud transmittance
// 9: full composite with clouds

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

float decodeViewDistance(vec2 uv) {
    return texture(gViewData, uv).x;
}

bool planetOccludes(vec3 dir) {
    float radius = max(planetRadius, atmosphereRadius);
    float b = dot(camPos, dir);
    float c = dot(camPos, camPos) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return false;
    float t = -b - sqrt(h);
    return t > 0.0;
}

bool projectDirection(vec3 dir, out vec2 screenUV) {
    vec3 d = normalize(dir);
    vec3 viewDir = vec3(dot(d, camRight), dot(d, camUp), dot(d, camForward));
    if (viewDir.z <= 0.0) return false;

    vec2 ndc = vec2(viewDir.x, viewDir.y) / max(viewDir.z, 1e-5);
    ndc /= tanHalfFov;
    ndc.x /= aspect;
    screenUV = ndc * 0.5 + 0.5;
    return screenUV.x >= -0.1 && screenUV.x <= 1.1 && screenUV.y >= -0.1 && screenUV.y <= 1.1;
}

float angularRadiusToScreen(float angle) {
    float projected = tan(angle);
    float ndcRadiusY = projected / tanHalfFov;
    float ndcRadiusX = ndcRadiusY / aspect;
    return 0.5 * max(ndcRadiusX, ndcRadiusY);
}

vec3 sphereNormal(vec3 dir, vec2 offset, float radius) {
    vec2 normalizedOffset = offset / max(radius, 1e-5);
    float r2 = dot(normalizedOffset, normalizedOffset);
    float z = sqrt(max(1.0 - r2, 0.0));

    vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(ref, dir));
    vec3 bitangent = normalize(cross(dir, tangent));

    return normalize(normalizedOffset.x * tangent + normalizedOffset.y * bitangent + z * dir);
}

vec3 renderSun(vec2 uv) {
    vec2 screenUV;
    if (!projectDirection(sunDir, screenUV)) return vec3(0.0);
    if (planetOccludes(sunDir)) return vec3(0.0);

    float radius = angularRadiusToScreen(radians(1.35));
    vec2 toCenter = uv - screenUV;
    float dist = length(toCenter);
    if (dist >= radius) return vec3(0.0);

    vec3 normal = sphereNormal(normalize(sunDir), toCenter, radius);
    float facing = max(dot(normal, normalize(sunDir)), 0.0);
    float rim = smoothstep(1.0, 0.0, dist / max(radius, 1e-5));

    vec3 base = vec3(1.55, 1.22, 0.78);
    float glow = pow(rim, 1.5) + pow(facing, 6.0);
    return base * sunPower * (1.1 * rim + 1.4 * glow);
}

vec3 renderMoon(vec2 uv) {
    vec2 screenUV;
    if (!projectDirection(moonDir, screenUV)) return vec3(0.0);
    if (planetOccludes(moonDir)) return vec3(0.0);

    float radius = angularRadiusToScreen(radians(0.52));
    vec2 toCenter = uv - screenUV;
    float dist = length(toCenter);
    if (dist >= radius) return vec3(0.0);

    vec3 normal = sphereNormal(normalize(moonDir), toCenter, radius);
    float lambert = max(dot(normal, normalize(-sunDir)), 0.0);
    float rim = smoothstep(1.0, 0.0, dist / max(radius, 1e-5));
    float softness = pow(max(normal.z, 0.0), 0.65);
    float phase = clamp(0.35 + 0.65 * dot(normalize(-sunDir), normalize(moonDir)), 0.0, 1.0);

    vec3 albedo = vec3(0.74, 0.78, 0.84);
    float brightness = (0.12 + lambert * 0.9) * rim * softness * phase;
    return albedo * moonPower * brightness;
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    float waterFlag = normalFlags.w;
    vec4 material = decodeMaterial(uv);
    vec3 albedo = material.rgb;
    float viewDistance = decodeViewDistance(uv);

    bool hit = waterFlag > -0.5;

    vec4 lightingSample = texture(lightingTex, uv);
    vec4 atmosphereSample = texture(atmosphereTex, uv);
    vec4 cloudSample = texture(cloudTex, uv);

    float sdfDepth = clamp(viewDistance / maxRayDistance, 0.0, 1.0);
    float heightView = clamp((heightValue + heightScale) / (heightScale * 2.0), 0.0, 1.0);

    float shadow = lightingSample.a;
    float cloudTransmittance = cloudSample.a;
    float atmosphereTransmittance = atmosphereSample.a;

    vec3 lighting = lightingSample.rgb;
    vec3 atmosphere = atmosphereSample.rgb;
    vec3 clouds = cloudSample.rgb;

    int level = clamp(debugLevel, 1, 9);

    if (level == 1) {
        FragColor = vec4(vec3(sdfDepth), 1.0);
        return;
    }

    if (level == 2) {
        FragColor = vec4(vec3(heightView), 1.0);
        return;
    }

    vec3 surface = albedo;

    if (level >= 4) {
        surface *= shadow;
    }

    if (level >= 5) {
        surface = lighting;
    }

    bool hitSurface = hit;
    float litTransmittance = 1.0;
    if (level >= 6) {
        litTransmittance = hitSurface ? mix(1.0, atmosphereTransmittance, 0.75) : atmosphereTransmittance;
    }

    float cloudBlend = (level >= 8) ? cloudTransmittance : 1.0;

    vec3 composite = surface * litTransmittance * cloudBlend;

    if (level >= 7) {
        float surfaceHaze = hitSurface ? 0.55 : 1.0;
        composite += atmosphere * surfaceHaze * cloudBlend;
    }

    if (level >= 9) {
        composite += clouds;
    }

    if (level >= 7) {
        composite += renderSun(uv);
        composite += renderMoon(uv);
    }

    FragColor = vec4(composite, 1.0);
}
