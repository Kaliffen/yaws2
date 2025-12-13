#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D gViewData;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float sunPower;
uniform float planetRadius;
uniform float seaLevel;
uniform vec3 waterColor;
uniform float waterAbsorption;
uniform float waterScattering;

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

vec4 decodeViewData(vec2 uv) {
    return texture(gViewData, uv);
}

vec3 computeSunTint(vec3 position, vec3 lightDir) {
    float sunHeight = clamp(dot(normalize(position), lightDir), -1.0, 1.0);

    float dayFactor = smoothstep(-0.02, 0.08, sunHeight);
    float goldenBand = 1.0 - smoothstep(0.01, 0.17, abs(sunHeight));

    vec3 nightColor = vec3(0.04, 0.07, 0.12);
    vec3 dayColor = vec3(0.94, 0.95, 0.93);
    vec3 goldenColor = vec3(1.04, 0.72, 0.46);
    vec3 twilightColor = vec3(0.48, 0.36, 0.60);

    vec3 warmBlend = mix(dayColor, goldenColor, goldenBand * 1.35);
    vec3 base = mix(nightColor, warmBlend, dayFactor);
    return mix(base, twilightColor, goldenBand * 0.15);
}

float computeShadow(vec3 pos, vec3 normal) {
    vec3 lightDir = normalize(sunDir);
    float ndl = dot(normal, lightDir);
    float horizon = smoothstep(-0.2, 0.05, ndl);
    return clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * horizon;
}

vec3 shadeWaterSurface(
    vec3 pos,
    vec3 normal,
    vec3 sunColor,
    float shadow,
    vec3 ambientLight
) {
    vec3 lightDir = normalize(sunDir);
    vec3 viewDir = normalize(camPos - pos);

    float ndl = max(dot(normal, lightDir), 0.0);
    float viewFacing = max(dot(normal, viewDir), 0.0);
    float fresnel = 0.02 + pow(1.0 - viewFacing, 5.0);
    float scatterBoost = mix(0.25, 0.85, waterScattering);

    vec3 base = waterColor * (ambientLight + sunColor * (0.35 + 0.65 * ndl * shadow));
    vec3 reflection = mix(waterColor, sunColor, 0.35 * scatterBoost) * (0.4 + 0.6 * shadow * ndl);
    vec3 color = mix(base, reflection, fresnel);

    float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 42.0) * shadow;
    color += spec * sunColor * mix(0.08, 0.26, scatterBoost);

    return color;
}

vec3 applyWaterFog(vec3 color, float waterPath, vec3 sunColor, vec3 ambientLight) {
    float attenuation = exp(-waterAbsorption * waterPath * 0.65);
    float murk = smoothstep(0.0, 140.0, waterPath);
    float scatter = mix(0.25, 0.85, waterScattering);
    vec3 fog = mix(waterColor * 0.25, waterColor * 0.65, murk) * (sunColor * (0.15 + 0.35 * scatter) + ambientLight * 0.55);
    return mix(fog, color, attenuation);
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    vec3 normal = normalize(normalFlags.xyz);
    float waterFlag = normalFlags.w;
    vec3 albedo = decodeAlbedo(uv);
    vec4 viewData = decodeViewData(uv);

    bool hit = waterFlag > -0.5;

    vec3 lightDir = normalize(sunDir);
    vec3 viewDir = normalize(camPos - pos);

    float rawNdl = dot(normal, lightDir);
    float ndl = max(rawNdl, 0.0);
    float wrapNdl = clamp((rawNdl + 0.65) / 1.65, 0.0, 1.0);
    float horizonBlend = smoothstep(-0.18, 0.25, rawNdl);
    float softHalo = smoothstep(-0.4, -0.05, rawNdl) * (1.0 - horizonBlend);
    float sunHeight = dot(normalize(pos), lightDir);

    float sunIntensity = max(sunPower, 0.0);
    vec3 sunColor = computeSunTint(pos, lightDir) * sunIntensity;
    float sunVisibility = smoothstep(-0.02, 0.04, sunHeight);
    vec3 effectiveSunColor = sunColor * sunVisibility;
    float twilight = smoothstep(-0.18, 0.04, sunHeight);
    vec3 ambientLight = mix(vec3(0.02, 0.04, 0.06), vec3(0.16, 0.22, 0.32), twilight);
    float ambientStrength = mix(0.02, 0.14, twilight);

    softHalo *= sunVisibility;

    vec3 directLight = effectiveSunColor * (wrapNdl * horizonBlend + softHalo * 0.5);
    vec3 ambient = ambientLight * (ambientStrength + softHalo * 0.25);

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    float distToPos = viewData.x;
    vec3 toPos = pos - camPos;
    vec3 viewDir2 = distToPos > 0.0 ? toPos / distToPos : vec3(0.0, 0.0, 1.0);
    float waterPath = max(viewData.w, 0.0);

    vec3 color = albedo * (ambient + directLight * shadow);
    if (waterFlag > 0.5) {
        color = shadeWaterSurface(pos, normal, effectiveSunColor, shadow, ambient);
    } else {
        float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 24.0) * shadow;
        color += spec * effectiveSunColor * 0.08;
    }

    if (waterPath > 0.0) {
        color = applyWaterFog(color, waterPath, effectiveSunColor, ambient);
    }

    FragColor = vec4(color, shadow);
}
