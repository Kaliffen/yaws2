#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float seaLevel;

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

float decodeHeight(vec2 uv) {
    return texture(gPositionHeight, uv).w;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec3 decodeAlbedo(vec2 uv) {
    return texture(gMaterial, uv).rgb;
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

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    vec3 normal = normalize(normalFlags.xyz);
    float waterFlag = normalFlags.w;
    vec3 albedo = decodeAlbedo(uv);

    bool hit = waterFlag > -0.5;

    vec3 lightDir = normalize(sunDir);
    float ndl = max(dot(normal, lightDir), 0.0);
    float horizonBlend = smoothstep(0.0, 0.22, ndl);
    float ambient = 0.08;
    float lighting = hit ? clamp(ambient + ndl * horizonBlend, 0.0, 1.0) : 0.0;

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    float waterDepth = (waterFlag > 0.5) ? max(seaLevel - heightValue, 0.0) : 0.0;
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth);

    vec3 color = albedo * lighting;
    if (waterFlag > 0.5) {
        color = waterShaded;
    }
    color *= shadow;

    FragColor = vec4(color, shadow);
}
