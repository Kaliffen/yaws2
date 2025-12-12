#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D lightingTex;
uniform sampler2D atmosphereTex;
uniform sampler2D cloudTex;

uniform float heightScale;
uniform float maxRayDistance;

uniform int debugLevel;

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

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    float waterFlag = normalFlags.w;
    vec4 material = decodeMaterial(uv);
    vec3 albedo = material.rgb;

    bool hit = waterFlag > -0.5;

    vec4 lightingSample = texture(lightingTex, uv);
    vec4 atmosphereSample = texture(atmosphereTex, uv);
    vec4 cloudSample = texture(cloudTex, uv);

    float sdfDepth = clamp(length(pos) / maxRayDistance, 0.0, 1.0);
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

    FragColor = vec4(composite, 1.0);
}
