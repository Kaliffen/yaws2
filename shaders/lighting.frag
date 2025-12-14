#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D gViewData;
uniform sampler2D gMaterialProps;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float sunPower;
uniform vec3 moonDir;
uniform float moonPower;
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

vec4 decodeMaterialProps(vec2 uv) {
    return texture(gMaterialProps, uv);
}

vec4 decodeViewData(vec2 uv) {
    return texture(gViewData, uv);
}

vec3 computeSunTint(vec3 position, vec3 lightDir) {
    float sunHeight = clamp(dot(normalize(position), lightDir), -1.0, 1.0);

    float dayFactor = smoothstep(-0.02, 0.08, sunHeight);
    float goldenBand = 1.0 - smoothstep(0.01, 0.25, abs(sunHeight));

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

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    vec3 normal = normalize(normalFlags.xyz);
    float waterFlag = normalFlags.w;
    vec3 albedo = decodeAlbedo(uv);
    vec4 materialProps = decodeMaterialProps(uv);
    vec4 viewData = decodeViewData(uv);

    bool hit = waterFlag > -0.5;

    vec3 lightDir = normalize(sunDir);
    vec3 moonLightDir = normalize(moonDir);
    vec3 viewDir = normalize(camPos - pos);

    float ndl = max(dot(normal, lightDir), 0.0);
    float moonNdl = max(dot(normal, moonLightDir), 0.0);
    float sunHeight = dot(normalize(pos), lightDir);
    float moonHeight = dot(normalize(pos), moonLightDir);

    float sunIntensity = max(sunPower, 0.0);
    vec3 sunRadiance = computeSunTint(pos, lightDir) * sunIntensity;
    float moonIntensity = max(moonPower, 0.0);
    vec3 moonRadiance = vec3(0.72, 0.78, 0.90) * moonIntensity;

    float sunVisibility = smoothstep(-0.12, 0.08, sunHeight);
    float moonVisibility = smoothstep(-0.30, 0.02, moonHeight);
    sunRadiance *= sunVisibility;
    moonRadiance *= moonVisibility;

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    float roughness = clamp(materialProps.x, 0.02, 1.0);
    float specularStrength = materialProps.y;
    float waterMask = materialProps.w;

    vec3 viewDir2 = normalize(camPos - pos);
    vec3 diffuse = (albedo / 3.14159265) * (sunRadiance * ndl + moonRadiance * moonNdl) * shadow;

    vec3 specular = vec3(0.0);
    if (specularStrength > 0.0) {
        vec3 halfSun = normalize(lightDir + viewDir2);
        vec3 halfMoon = normalize(moonLightDir + viewDir2);
        float shininess = mix(24.0, 180.0, 1.0 - roughness);
        float fresnel = 0.02 + pow(1.0 - max(dot(viewDir2, normal), 0.0), 5.0);
        float sunSpec = pow(max(dot(normal, halfSun), 0.0), shininess) * specularStrength;
        float moonSpec = pow(max(dot(normal, halfMoon), 0.0), shininess * 0.75) * specularStrength;
        specular += sunRadiance * sunSpec * fresnel * shadow;
        specular += moonRadiance * moonSpec * fresnel * shadow;
    }

    if (waterMask > 0.5) {
        float viewFacing = max(dot(normal, viewDir2), 0.05);
        float waterDepth = max(seaLevel - heightValue, 0.0);
        float waterPath = max(viewData.w, 0.0);
        float pathLength = waterDepth / viewFacing + waterPath;
        float attenuation = exp(-waterAbsorption * pathLength * 0.5);
        diffuse *= attenuation;
        specular *= attenuation;
        diffuse += waterColor * (1.0 - attenuation) * sunRadiance * 0.02 * shadow;
    }

    vec3 color = diffuse + specular;
    FragColor = vec4(color, shadow);
}
